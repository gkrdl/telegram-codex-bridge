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

test('includes reply target when sending a reply message', async () => {
  let payload;
  const client = new TelegramClient({
    token: 'token',
    fetchImpl: async (url, options = {}) => {
      payload = JSON.parse(options.body);
      assert.match(String(url), /sendMessage/);
      return okResponse({ result: { message_id: 1 } });
    },
  });

  await client.sendMessage('123', 'hello', { replyToMessageId: 77 });

  assert.equal(payload.reply_to_message_id, 77);
});

function okResponse(body) {
  return {
    status: 200,
    async json() {
      return { ok: true, ...body };
    },
  };
}
