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
