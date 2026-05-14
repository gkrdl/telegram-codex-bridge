import test from 'node:test';
import assert from 'node:assert/strict';

import { TelegramClient } from '../src/telegram.js';

test('adds an abort signal to long polling requests', async () => {
  let capturedSignal;
  const client = new TelegramClient({
    token: 'token',
    fetchImpl: async (url, options = {}) => {
      capturedSignal = options.signal;
      assert.match(String(url), /timeout=25/);
      return okResponse({ result: [] });
    },
  });

  await client.getUpdates({ timeoutSeconds: 25 });

  assert.ok(capturedSignal instanceof AbortSignal);
});

test('adds an abort signal to send requests', async () => {
  let capturedSignal;
  const client = new TelegramClient({
    token: 'token',
    fetchImpl: async (url, options = {}) => {
      capturedSignal = options.signal;
      assert.match(String(url), /sendMessage/);
      return okResponse({ result: { message_id: 1 } });
    },
  });

  await client.sendMessage('123', 'hello');

  assert.ok(capturedSignal instanceof AbortSignal);
});

function okResponse(body) {
  return {
    status: 200,
    async json() {
      return { ok: true, ...body };
    },
  };
}
