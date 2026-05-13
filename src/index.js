#!/usr/bin/env node
import { loadConfig, assertConfig } from './config.js';
import { CodexRunner } from './codexRunner.js';
import { findSession, readRecentSessions } from './codexSessions.js';
import { routeMessage, helpText } from './router.js';
import { SessionStore } from './sessionStore.js';
import { TelegramClient, getChatId, getMessageText, getSenderId } from './telegram.js';

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

  const chatState = await store.getChatState(chatId);
  const decision = routeMessage(text, chatState);
  await executeDecision({ decision, chatId, telegram, store, codex, config });
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
      await telegram.sendMessage(chatId, 'Running one-off Codex task...');
      const result = await codex.runOnce(decision.prompt);
      await telegram.sendMessage(chatId, result.finalMessage);
      return;
    }
    case 'new': {
      await telegram.sendMessage(chatId, 'Starting a new Codex session...');
      const result = await codex.runNew(decision.prompt);
      const session = (await readRecentSessions(config.codexHome, 1))[0];
      if (session) {
        await store.setActiveSession(chatId, {
          sessionId: session.id,
          cwd: config.defaultCwd,
          title: session.title,
        });
      }
      await telegram.sendMessage(chatId, formatResult(result.finalMessage, session));
      return;
    }
    case 'resume': {
      await telegram.sendMessage(chatId, `Continuing Codex session ${decision.sessionId}...`);
      const result = await codex.resume(decision.sessionId, decision.prompt);
      await telegram.sendMessage(chatId, result.finalMessage);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
