import test from 'node:test';
import assert from 'node:assert/strict';

import { executeDecision } from '../src/index.js';
import { SessionJobQueue } from '../src/jobQueue.js';

test('returns immediately after scheduling a Codex job even when Telegram ack is slow', async () => {
  const jobQueue = new SessionJobQueue();
  let releaseTelegram;
  const telegramBlocked = new Promise((resolve) => {
    releaseTelegram = resolve;
  });
  const telegram = {
    async sendMessage() {
      await telegramBlocked;
      return { message_id: 1 };
    },
    async editMessageText() {},
  };
  const store = {
    async getChatState() {
      return {};
    },
    async setActiveSession() {},
  };
  const codex = {
    async runOnce() {
      return { finalMessage: 'done' };
    },
  };

  let returned = false;
  const decisionPromise = executeDecision({
    decision: { action: 'once', prompt: 'quick task' },
    chatId: '123',
    telegram,
    store,
    codex,
    config: { browserUseMode: 'never' },
    jobQueue,
  }).then(() => {
    returned = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(returned, true);

  releaseTelegram();
  await decisionPromise;
});

test('sends Codex job notifications as replies to the source Telegram message', async () => {
  const jobQueue = new SessionJobQueue();
  const sent = [];
  const telegram = {
    async sendMessage(chatId, text, options = {}) {
      sent.push({ chatId, text, options });
      return { message_id: sent.length };
    },
    async editMessageText() {},
  };
  const store = {
    async getChatState() {
      return {};
    },
    async setActiveSession() {},
  };
  const codex = {
    async runOnce() {
      return { finalMessage: 'done' };
    },
  };

  await executeDecision({
    decision: { action: 'once', prompt: 'quick task' },
    chatId: '123',
    replyToMessageId: 77,
    telegram,
    store,
    codex,
    config: { browserUseMode: 'never' },
    jobQueue,
  });
  await waitFor(() => sent.length >= 3);

  assert.equal(sent[0].options.replyToMessageId, 77);
  assert.equal(sent[1].options.replyToMessageId, 77);
  assert.equal(sent[2].options.replyToMessageId, 77);
});

async function waitFor(condition) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met before timeout');
}
