import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SessionStore } from '../src/sessionStore.js';

test('persists and reloads active session per chat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-store-'));
  try {
    const file = join(dir, 'state.json');
    const store = new SessionStore(file);
    await store.setActiveSession('123', {
      sessionId: 'abc',
      cwd: '/workspace',
      title: 'Bridge work',
    });

    const reloaded = new SessionStore(file);
    assert.deepEqual(await reloaded.getChatState('123'), {
      activeSessionId: 'abc',
      activeCwd: '/workspace',
      activeTitle: 'Bridge work',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('forgets active session without removing other chats', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-store-'));
  try {
    const file = join(dir, 'state.json');
    const store = new SessionStore(file);
    await store.setActiveSession('1', { sessionId: 'a', cwd: '/a', title: 'A' });
    await store.setActiveSession('2', { sessionId: 'b', cwd: '/b', title: 'B' });
    await store.forgetChat('1');

    assert.deepEqual(await store.getChatState('1'), {});
    assert.equal((await store.getChatState('2')).activeSessionId, 'b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serializes concurrent updates to avoid losing chat state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-store-'));
  try {
    const file = join(dir, 'state.json');
    const store = new SessionStore(file);

    await Promise.all([
      store.setActiveSession('1', { sessionId: 'a', cwd: '/a', title: 'A' }),
      store.setActiveSession('2', { sessionId: 'b', cwd: '/b', title: 'B' }),
    ]);

    assert.equal((await store.getChatState('1')).activeSessionId, 'a');
    assert.equal((await store.getChatState('2')).activeSessionId, 'b');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
