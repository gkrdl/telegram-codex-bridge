#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, assertConfig } from './config.js';
import { createCodexBackend } from './codexBackend.js';
import { CodexRunner } from './codexRunner.js';
import { findSession, readRecentSessions, upsertSessionIndex } from './codexSessions.js';
import { markThreadInteractive } from './codexStateDb.js';
import { SessionJobQueue } from './jobQueue.js';
import { routeMessage, helpText } from './router.js';
import { SessionStore } from './sessionStore.js';
import { TelegramClient, getChatId, getMessageId, getMessageText, getSenderId } from './telegram.js';
import { markdownToTelegramHtml } from './telegramFormat.js';

async function main() {
  const config = await loadConfig();
  assertConfig(config);

  const telegram = new TelegramClient({ token: config.telegramBotToken });
  const store = new SessionStore(config.stateFile);
  const browserUseRuntime = findCodexAppBrowserUseRuntime();
  const execRunner = new CodexRunner({
    codexHome: config.codexHome,
    defaultCwd: config.defaultCwd,
    codexCommand: config.codexCommand,
    model: config.model || undefined,
    skipGitRepoCheck: config.skipGitRepoCheck,
    sandboxMode: config.sandboxMode || undefined,
    approvalPolicy: config.approvalPolicy || undefined,
    browserUseRuntime,
  });
  const codex = await createCodexBackend({ execRunner });
  const jobQueue = new SessionJobQueue();

  console.log(`telegram-codex-bridge started with config ${config.configPath}`);
  let offset;
  for (;;) {
    try {
      const updates = await telegram.getUpdates({ offset, timeoutSeconds: config.pollTimeoutSeconds });
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate({ update, telegram, store, codex, config, jobQueue });
      }
    } catch (error) {
      console.error(`[bridge] ${error.stack || error.message}`);
      await sleep(2000);
    }
  }
}

export async function handleUpdate({ update, telegram, store, codex, config, jobQueue }) {
  const senderId = getSenderId(update);
  const chatId = getChatId(update);
  const replyToMessageId = getMessageId(update);
  const text = getMessageText(update);
  if (!chatId || !text) {
    return;
  }
  if (!config.allowedUsers.includes(senderId)) {
    await telegram.sendMessage(chatId, 'This Telegram user is not allowed to use this bridge.', replyOptions(replyToMessageId));
    return;
  }

  try {
    const chatState = await store.getChatState(chatId);
    const decision = routeMessage(text, chatState);
    await executeDecision({ decision, chatId, replyToMessageId, telegram, store, codex, config, jobQueue });
  } catch (error) {
    console.error(`[chat ${chatId}] ${error.stack || error.message}`);
    await telegram.sendMessage(chatId, `Codex bridge error:\n${cleanError(error)}`, replyOptions(replyToMessageId));
  }
}

export async function executeDecision({ decision, chatId, replyToMessageId = '', telegram, store, codex, config, jobQueue }) {
  const browserUseEnabled = shouldEnableBrowserUse(decision, config);
  switch (decision.action) {
    case 'reply':
      await telegram.sendMessage(chatId, decision.text, replyOptions(replyToMessageId));
      return;
    case 'help':
      await telegram.sendMessage(chatId, helpText(), replyOptions(replyToMessageId));
      return;
    case 'status':
      await telegram.sendMessage(chatId, await statusText({ store, chatId, config, jobQueue }), replyOptions(replyToMessageId));
      return;
    case 'sessions':
      await telegram.sendMessage(chatId, await sessionsText(config), replyOptions(replyToMessageId));
      return;
    case 'forget':
      await store.forgetChat(chatId);
      await telegram.sendMessage(chatId, 'Detached this chat from the active Codex session.', replyOptions(replyToMessageId));
      return;
    case 'attach': {
      const session = await findSession(config.codexHome, decision.sessionId);
      if (!session) {
        await telegram.sendMessage(chatId, `Could not find Codex session matching: ${decision.sessionId}`, replyOptions(replyToMessageId));
        return;
      }
      await store.setActiveSession(chatId, {
        sessionId: session.id,
        cwd: config.defaultCwd,
        title: session.title,
      });
      await telegram.sendMessage(chatId, `Attached to ${session.title}\n${session.id}`, replyOptions(replyToMessageId));
      return;
    }
    case 'once': {
      await scheduleCodexJob({
        jobQueue,
        telegram,
        chatId,
        replyToMessageId,
        label: 'Running one-off Codex task',
        run: async ({ progressMessage } = {}) => {
          const result = await runCodexWithProgress({
            telegram,
            chatId,
            replyToMessageId,
            progressMessage,
            label: 'Running one-off Codex task',
            run: (onProgress) => codex.runOnce(decision.prompt, { onProgress, browserUseEnabled }),
          });
          await sendFinalAnswer(telegram, chatId, result.finalMessage, replyToMessageId);
        },
      });
      return;
    }
    case 'new': {
      const title = titleFromPrompt(decision.prompt);
      await scheduleCodexJob({
        jobQueue,
        telegram,
        chatId,
        replyToMessageId,
        label: 'Starting new Codex session',
        run: async ({ progressMessage } = {}) => {
          let indexedSessionId = '';
          const result = await runCodexWithProgress({
            telegram,
            chatId,
            replyToMessageId,
            progressMessage,
            label: 'Starting new Codex session',
            onEvent: (event) => {
              const sessionId = event?.type === 'thread.started' ? event.thread_id : '';
              if (!sessionId || indexedSessionId === sessionId) {
                return;
              }
              indexedSessionId = sessionId;
              void upsertSessionIndex(config.codexHome, {
                id: sessionId,
                title,
                updatedAt: new Date().toISOString(),
              }).catch((error) => {
                console.error(`[session index ${chatId}] ${error.stack || error.message}`);
              });
              void markThreadInteractive(config.codexHome, sessionId).catch((error) => {
                console.error(`[session metadata ${chatId}] ${error.stack || error.message}`);
              });
              void store.setActiveSession(chatId, {
                sessionId,
                cwd: config.defaultCwd,
                title,
              }).catch((error) => {
                console.error(`[session store ${chatId}] ${error.stack || error.message}`);
              });
            },
            run: (onProgress) => codex.runNew(decision.prompt, { onProgress, browserUseEnabled }),
          });
          const sessionId = result.sessionId || indexedSessionId;
          if (sessionId) {
            await upsertSessionIndex(config.codexHome, {
              id: sessionId,
              title,
              updatedAt: new Date().toISOString(),
            });
            await markThreadInteractive(config.codexHome, sessionId);
          }
          const session = sessionId
            ? await findSession(config.codexHome, sessionId)
            : (await readRecentSessions(config.codexHome, 1))[0];
          if (session) {
            await store.setActiveSession(chatId, {
              sessionId: session.id,
              cwd: config.defaultCwd,
              title: session.title,
            });
          }
          await sendFinalAnswer(telegram, chatId, formatResult(result.finalMessage, session), replyToMessageId);
        },
      });
      return;
    }
    case 'resume': {
      await scheduleCodexJob({
        jobQueue,
        telegram,
        chatId,
        replyToMessageId,
        sessionKey: decision.sessionId,
        label: `Continuing Codex session ${decision.sessionId}`,
        run: async ({ progressMessage } = {}) => {
          try {
            const result = await runCodexWithProgress({
              telegram,
              chatId,
              replyToMessageId,
              progressMessage,
              label: `Continuing Codex session ${decision.sessionId}`,
              run: (onProgress) => codex.resume(decision.sessionId, decision.prompt, { onProgress, browserUseEnabled }),
            });
            await sendFinalAnswer(telegram, chatId, result.finalMessage, replyToMessageId);
          } catch (error) {
            if (!isMissingRolloutError(error)) {
              throw error;
            }
            await store.forgetChat(chatId);
            await telegram.sendMessage(
              chatId,
              [
                'Active Codex session is no longer available, so I detached this chat from it.',
                'Use /new <prompt> to start a new session, or /attach <session-id-or-title> to attach another one.',
              ].join('\n'),
              replyOptions(replyToMessageId),
            );
          }
        },
      });
      return;
    }
    default:
      await telegram.sendMessage(chatId, `Unknown bridge action: ${decision.action}`, replyOptions(replyToMessageId));
  }
}

function scheduleCodexJob({ jobQueue, telegram, chatId, replyToMessageId = '', sessionKey = '', label, run }) {
  let progressMessagePromise;
  const { id, promise } = jobQueue.enqueue({
    sessionKey,
    label,
    run: async (context) => run({
      ...context,
      progressMessage: await progressMessagePromise,
    }),
  });
  progressMessagePromise = telegram.sendMessage(
    chatId,
    formatProgressText(`${label} #${id}`, [], 'queued'),
    replyOptions(replyToMessageId),
  ).catch((error) => {
    console.error(`[job queued notify ${chatId}] ${error.stack || error.message}`);
    return null;
  });
  promise.catch(async (error) => {
    try {
      await telegram.sendMessage(chatId, `Codex bridge error:\n${cleanError(error)}`, replyOptions(replyToMessageId));
    } catch (telegramError) {
      console.error(`[job error notify ${chatId}] ${telegramError.stack || telegramError.message}`);
    }
  });
  return id;
}

function replyOptions(replyToMessageId, options = {}) {
  return replyToMessageId ? { ...options, replyToMessageId } : options;
}

function shouldEnableBrowserUse(decision, config) {
  if (config.browserUseMode === 'always') {
    return true;
  }
  if (config.browserUseMode === 'never') {
    return false;
  }
  if (!['new', 'resume', 'once'].includes(decision.action)) {
    return false;
  }
  return promptNeedsBrowserUse(decision.prompt);
}

function promptNeedsBrowserUse(prompt) {
  const text = String(prompt || '').toLowerCase();
  const patterns = [
    /https?:\/\//,
    /\blocalhost\b/,
    /\b127\.0\.0\.1\b/,
    /\b0\.0\.0\.0\b/,
    /\bchrome\b/,
    /\bbrowser\b/,
    /\bwebsite\b/,
    /\bweb\s?page\b/,
    /\bscreenshot\b/,
    /\bplaywright\b/,
    /\bdom\b/,
    /\bcaptcha\b/,
    /\blog\s?in\b/,
    /\bsign\s?in\b/,
    /브라우저/,
    /크롬/,
    /웹사이트/,
    /웹\s?페이지/,
    /사이트/,
    /스크린샷/,
    /로그인/,
    /캡차/,
    /열어/,
    /접속/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

async function statusText({ store, chatId, config, jobQueue }) {
  const chatState = await store.getChatState(chatId);
  const activeJobs = jobQueue
    ? jobQueue.snapshot().filter((job) => ['queued', 'running'].includes(job.status))
    : [];
  return [
    'Telegram Codex Bridge',
    `Codex home: ${config.codexHome}`,
    `Default cwd: ${config.defaultCwd}`,
    `Active session: ${chatState.activeSessionId || '(none)'}`,
    chatState.activeTitle ? `Title: ${chatState.activeTitle}` : '',
    activeJobs.length ? `Jobs:\n${activeJobs.map(formatJobStatus).join('\n')}` : 'Jobs: none',
  ].filter(Boolean).join('\n');
}

function formatJobStatus(job) {
  const session = job.sessionKey ? ` session=${job.sessionKey}` : '';
  return `#${job.id} ${job.status}${session} ${job.label}`;
}

async function sessionsText(config) {
  const sessions = await readRecentSessions(config.codexHome, config.recentSessionLimit);
  if (sessions.length === 0) {
    return 'No Codex sessions found.';
  }
  return sessions.map((session, index) => {
    return `${index + 1}. ${session.title}\n${session.id}\n${session.updatedAt}`;
  }).join('\n\n');
}

function formatResult(message, session) {
  if (!session) {
    return message;
  }
  return `${message}\n\nActive session: ${session.title}\n${session.id}`;
}

async function runCodexWithProgress({ telegram, chatId, replyToMessageId = '', progressMessage, label, run, onEvent }) {
  progressMessage ??= await telegram.sendMessage(
    chatId,
    formatProgressText(label, [], 'queued'),
    replyOptions(replyToMessageId),
  );
  let lastEditAt = 0;
  let lastText = '';
  const progressItems = [];

  const editProgress = async (text, force = false) => {
    const now = Date.now();
    if (!force && now - lastEditAt < 1500) {
      return;
    }
    if (text === lastText) {
      return;
    }
    lastEditAt = now;
    lastText = text;
    try {
      await telegram.editMessageText(chatId, progressMessage.message_id, text);
    } catch (error) {
      if (!String(error.message || '').includes('message is not modified')) {
        console.error(`[progress edit ${chatId}] ${error.stack || error.message}`);
      }
    }
  };

  try {
    await editProgress(formatProgressText(label, progressItems, 'running'), true);
    const result = await run((event) => {
      if (onEvent) {
        onEvent(event);
      }
      const item = progressLine(event);
      if (!item) {
        return;
      }
      progressItems.push(item);
      void editProgress(formatProgressText(label, progressItems));
    });
    await editProgress(formatProgressText(label, progressItems, 'completed'), true);
    return result;
  } catch (error) {
    await editProgress(formatProgressText(label, progressItems, 'failed'), true);
    throw error;
  }
}

function formatProgressText(label, progressItems, status = '') {
  const lines = [`${label}...`, `Updated: ${timeText()}`];
  if (status) {
    lines.push(`Status: ${status}`);
  }
  const recent = progressItems.slice(-5).map((line) => `- ${line}`);
  return [...lines, ...recent].join('\n');
}

function timeText(date = new Date()) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

function titleFromPrompt(prompt) {
  const compact = String(prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Telegram Codex session';
  }
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

function progressLine(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  if (event.type === 'thread.started') {
    return `thread ${event.thread_id || 'started'}`;
  }
  if (event.type === 'agent_message.delta') {
    return progressSnippet(event.delta, 'assistant');
  }
  if (event.type === 'message' && event.role === 'assistant') {
    return progressSnippet(event.content, 'assistant');
  }
  if (event.type === 'final_message') {
    return progressSnippet(event.message ?? event.content ?? event.text, 'assistant');
  }
  if (event.type === 'turn.started') {
    return 'turn started';
  }
  if (event.type === 'turn.completed') {
    return 'turn completed';
  }
  if (event.type === 'item.started') {
    return describeItem(event.item, 'started');
  }
  if (event.type === 'item.completed') {
    return describeItem(event.item, 'completed');
  }
  return event.type ? String(event.type) : '';
}

function describeItem(item, fallback) {
  if (!item || typeof item !== 'object') {
    return fallback;
  }
  if (item.type === 'agent_message') {
    return progressSnippet(item.text ?? item.content, 'assistant') || 'assistant response ready';
  }
  if (item.type === 'tool_call') {
    return progressSnippet(item.output ?? item.result, `tool ${item.name || item.call_id || fallback}`)
      || `tool ${item.name || item.call_id || fallback}`;
  }
  return `${item.type || 'item'} ${fallback}`;
}

function progressSnippet(value, prefix) {
  const text = contentToText(value).replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  const snippet = text.length <= 240 ? text : `${text.slice(0, 237)}...`;
  return `${prefix}: ${snippet}`;
}

function contentToText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      return item?.text ?? item?.content ?? '';
    }).filter(Boolean).join(' ');
  }
  return '';
}

async function sendFinalAnswer(telegram, chatId, markdown, replyToMessageId = '') {
  try {
    await telegram.sendMessage(
      chatId,
      markdownToTelegramHtml(markdown),
      replyOptions(replyToMessageId, { parseMode: 'HTML' }),
    );
  } catch (error) {
    console.error(`[telegram html fallback ${chatId}] ${error.stack || error.message}`);
    await telegram.sendMessage(chatId, markdown, replyOptions(replyToMessageId));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanError(error) {
  const message = error?.message || String(error);
  return message.length <= 1500 ? message : `${message.slice(0, 1500)}\n...[truncated]`;
}

function isMissingRolloutError(error) {
  const message = error?.message || String(error);
  return message.includes('no rollout found for thread id');
}

function findCodexAppBrowserUseRuntime() {
  const resourcesPath = '/Applications/Codex.app/Contents/Resources';
  const runtime = {
    codexCliPath: join(resourcesPath, 'codex'),
    nodeReplPath: join(resourcesPath, 'node_repl'),
    nodePath: join(resourcesPath, 'node'),
    backends: ['chrome', 'iab'],
  };
  return [runtime.codexCliPath, runtime.nodeReplPath, runtime.nodePath].every((path) => existsSync(path))
    ? runtime
    : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
