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
import { TelegramClient, getChatId, getMessageText, getSenderId } from './telegram.js';
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
  const text = getMessageText(update);
  if (!chatId || !text) {
    return;
  }
  if (!config.allowedUsers.includes(senderId)) {
    await telegram.sendMessage(chatId, 'This Telegram user is not allowed to use this bridge.');
    return;
  }

  try {
    const chatState = await store.getChatState(chatId);
    const decision = routeMessage(text, chatState);
    await executeDecision({ decision, chatId, telegram, store, codex, config, jobQueue });
  } catch (error) {
    console.error(`[chat ${chatId}] ${error.stack || error.message}`);
    await telegram.sendMessage(chatId, `Codex bridge error:\n${cleanError(error)}`);
  }
}

export async function executeDecision({ decision, chatId, telegram, store, codex, config, jobQueue }) {
  const browserUseEnabled = shouldEnableBrowserUse(decision, config);
  switch (decision.action) {
    case 'reply':
      await telegram.sendMessage(chatId, decision.text);
      return;
    case 'help':
      await telegram.sendMessage(chatId, helpText());
      return;
    case 'status':
      await telegram.sendMessage(chatId, await statusText({ store, chatId, config, jobQueue }));
      return;
    case 'sessions':
      await telegram.sendMessage(chatId, await sessionsText(config));
      return;
    case 'forget':
      await store.forgetChat(chatId);
      await telegram.sendMessage(chatId, 'Detached this chat from the active Codex session.');
      return;
    case 'attach': {
      const session = await findSession(config.codexHome, decision.sessionId);
      if (!session) {
        await telegram.sendMessage(chatId, `Could not find Codex session matching: ${decision.sessionId}`);
        return;
      }
      await store.setActiveSession(chatId, {
        sessionId: session.id,
        cwd: config.defaultCwd,
        title: session.title,
      });
      await telegram.sendMessage(chatId, `Attached to ${session.title}\n${session.id}`);
      return;
    }
    case 'once': {
      await scheduleCodexJob({
        jobQueue,
        telegram,
        chatId,
        label: 'Running one-off Codex task',
        run: async () => {
          const result = await runCodexWithProgress({
            telegram,
            chatId,
            label: 'Running one-off Codex task',
            run: (onProgress) => codex.runOnce(decision.prompt, { onProgress, browserUseEnabled }),
          });
          await sendFinalAnswer(telegram, chatId, result.finalMessage);
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
        label: 'Starting new Codex session',
        run: async () => {
          let indexedSessionId = '';
          const result = await runCodexWithProgress({
            telegram,
            chatId,
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
          await sendFinalAnswer(telegram, chatId, formatResult(result.finalMessage, session));
        },
      });
      return;
    }
    case 'resume': {
      await scheduleCodexJob({
        jobQueue,
        telegram,
        chatId,
        sessionKey: decision.sessionId,
        label: `Continuing Codex session ${decision.sessionId}`,
        run: async () => {
          const result = await runCodexWithProgress({
            telegram,
            chatId,
            label: `Continuing Codex session ${decision.sessionId}`,
            run: (onProgress) => codex.resume(decision.sessionId, decision.prompt, { onProgress, browserUseEnabled }),
          });
          await sendFinalAnswer(telegram, chatId, result.finalMessage);
        },
      });
      return;
    }
    default:
      await telegram.sendMessage(chatId, `Unknown bridge action: ${decision.action}`);
  }
}

function scheduleCodexJob({ jobQueue, telegram, chatId, sessionKey = '', label, run }) {
  const { id, promise } = jobQueue.enqueue({ sessionKey, label, run });
  void telegram.sendMessage(chatId, `Queued Codex job #${id}\n${label}`).catch((error) => {
    console.error(`[job queued notify ${chatId}] ${error.stack || error.message}`);
  });
  promise.catch(async (error) => {
    try {
      await telegram.sendMessage(chatId, `Codex bridge error:\n${cleanError(error)}`);
    } catch (telegramError) {
      console.error(`[job error notify ${chatId}] ${telegramError.stack || telegramError.message}`);
    }
  });
  return id;
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

async function runCodexWithProgress({ telegram, chatId, label, run, onEvent }) {
  const progressMessage = await telegram.sendMessage(chatId, `${label}...\nStatus: queued`);
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
    const result = await run((event) => {
      if (onEvent) {
        onEvent(event);
      }
      const item = progressLine(event);
      if (!item) {
        return;
      }
      progressItems.push(item);
      const recent = progressItems.slice(-5).map((line) => `- ${line}`).join('\n');
      void editProgress(`${label}...\n${recent}`);
    });
    await editProgress(`${label}\nStatus: completed`, true);
    return result;
  } catch (error) {
    await editProgress(`${label}\nStatus: failed`, true);
    throw error;
  }
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
    return 'assistant response ready';
  }
  if (item.type === 'tool_call') {
    return `tool ${item.name || item.call_id || fallback}`;
  }
  return `${item.type || 'item'} ${fallback}`;
}

async function sendFinalAnswer(telegram, chatId, markdown) {
  try {
    await telegram.sendMessage(chatId, markdownToTelegramHtml(markdown), { parseMode: 'HTML' });
  } catch (error) {
    console.error(`[telegram html fallback ${chatId}] ${error.stack || error.message}`);
    await telegram.sendMessage(chatId, markdown);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanError(error) {
  const message = error?.message || String(error);
  return message.length <= 1500 ? message : `${message.slice(0, 1500)}\n...[truncated]`;
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
