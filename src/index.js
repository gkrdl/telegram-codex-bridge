#!/usr/bin/env node
import { loadConfig, assertConfig } from './config.js';
import { CodexRunner } from './codexRunner.js';
import { findSession, readRecentSessions, upsertSessionIndex } from './codexSessions.js';
import { markThreadInteractive } from './codexStateDb.js';
import { routeMessage, helpText } from './router.js';
import { SessionStore } from './sessionStore.js';
import { TelegramClient, getChatId, getMessageText, getSenderId } from './telegram.js';
import { markdownToTelegramHtml } from './telegramFormat.js';

async function main() {
  const config = await loadConfig();
  assertConfig(config);

  const telegram = new TelegramClient({ token: config.telegramBotToken });
  const store = new SessionStore(config.stateFile);
  const codex = new CodexRunner({
    codexHome: config.codexHome,
    defaultCwd: config.defaultCwd,
    codexCommand: config.codexCommand,
    model: config.model || undefined,
    skipGitRepoCheck: config.skipGitRepoCheck,
    sandboxMode: config.sandboxMode || undefined,
    approvalPolicy: config.approvalPolicy || undefined,
  });

  console.log(`telegram-codex-bridge started with config ${config.configPath}`);
  let offset;
  for (;;) {
    try {
      const updates = await telegram.getUpdates({ offset, timeoutSeconds: config.pollTimeoutSeconds });
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate({ update, telegram, store, codex, config });
      }
    } catch (error) {
      console.error(`[bridge] ${error.stack || error.message}`);
      await sleep(2000);
    }
  }
}

async function handleUpdate({ update, telegram, store, codex, config }) {
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
    await executeDecision({ decision, chatId, telegram, store, codex, config });
  } catch (error) {
    console.error(`[chat ${chatId}] ${error.stack || error.message}`);
    await telegram.sendMessage(chatId, `Codex bridge error:\n${cleanError(error)}`);
  }
}

async function executeDecision({ decision, chatId, telegram, store, codex, config }) {
  switch (decision.action) {
    case 'reply':
      await telegram.sendMessage(chatId, decision.text);
      return;
    case 'help':
      await telegram.sendMessage(chatId, helpText());
      return;
    case 'status':
      await telegram.sendMessage(chatId, await statusText({ store, chatId, config }));
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
      const result = await runCodexWithProgress({
        telegram,
        chatId,
        label: 'Running one-off Codex task',
        run: (onProgress) => codex.runOnce(decision.prompt, { onProgress }),
      });
      await sendFinalAnswer(telegram, chatId, result.finalMessage);
      return;
    }
    case 'new': {
      let indexedSessionId = '';
      const title = titleFromPrompt(decision.prompt);
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
        },
        run: (onProgress) => codex.runNew(decision.prompt, { onProgress }),
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
      return;
    }
    case 'resume': {
      const result = await runCodexWithProgress({
        telegram,
        chatId,
        label: `Continuing Codex session ${decision.sessionId}`,
        run: (onProgress) => codex.resume(decision.sessionId, decision.prompt, { onProgress }),
      });
      await sendFinalAnswer(telegram, chatId, result.finalMessage);
      return;
    }
    default:
      await telegram.sendMessage(chatId, `Unknown bridge action: ${decision.action}`);
  }
}

async function statusText({ store, chatId, config }) {
  const chatState = await store.getChatState(chatId);
  return [
    'Telegram Codex Bridge',
    `Codex home: ${config.codexHome}`,
    `Default cwd: ${config.defaultCwd}`,
    `Active session: ${chatState.activeSessionId || '(none)'}`,
    chatState.activeTitle ? `Title: ${chatState.activeTitle}` : '',
  ].filter(Boolean).join('\n');
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
