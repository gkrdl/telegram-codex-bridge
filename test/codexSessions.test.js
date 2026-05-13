import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readRecentSessions, upsertSessionIndex } from '../src/codexSessions.js';

test('reads recent sessions from Codex session_index.jsonl newest first', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-index-'));
  try {
    const codexHome = join(dir, '.codex');
    await writeFile(join(dir, 'placeholder'), '');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(codexHome));
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        JSON.stringify({ id: 'old', thread_name: 'Old task', updated_at: '2026-05-13T00:00:00Z' }),
        'not json',
        JSON.stringify({ id: 'new', thread_name: 'New task', updated_at: '2026-05-14T00:00:00Z' }),
      ].join('\n'),
    );

    assert.deepEqual(await readRecentSessions(codexHome, 2), [
      { id: 'new', title: 'New task', updatedAt: '2026-05-14T00:00:00Z' },
      { id: 'old', title: 'Old task', updatedAt: '2026-05-13T00:00:00Z' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upserts a Codex session index entry for externally created sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-index-'));
  try {
    const codexHome = join(dir, '.codex');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(codexHome));
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      `${JSON.stringify({ id: 'existing', thread_name: 'Existing', updated_at: '2026-05-13T00:00:00Z' })}\n`,
    );

    await upsertSessionIndex(codexHome, {
      id: 'new-session',
      title: 'Bridge prompt',
      updatedAt: '2026-05-14T00:00:00Z',
    });

    assert.deepEqual(await readRecentSessions(codexHome, 2), [
      { id: 'new-session', title: 'Bridge prompt', updatedAt: '2026-05-14T00:00:00Z' },
      { id: 'existing', title: 'Existing', updatedAt: '2026-05-13T00:00:00Z' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upserting a session index entry replaces stale entries with the same id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-index-'));
  try {
    const codexHome = join(dir, '.codex');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(codexHome));
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        JSON.stringify({ id: 'same', thread_name: 'Old title', updated_at: '2026-05-13T00:00:00Z' }),
        JSON.stringify({ id: 'other', thread_name: 'Other', updated_at: '2026-05-13T01:00:00Z' }),
        '',
      ].join('\n'),
    );

    await upsertSessionIndex(codexHome, {
      id: 'same',
      title: 'New title',
      updatedAt: '2026-05-14T00:00:00Z',
    });

    const raw = await readFile(join(codexHome, 'session_index.jsonl'), 'utf8');
    const matchingLines = raw.split(/\r?\n/).filter((line) => line.includes('"id":"same"'));

    assert.equal(matchingLines.length, 1);
    assert.deepEqual(await readRecentSessions(codexHome, 2), [
      { id: 'same', title: 'New title', updatedAt: '2026-05-14T00:00:00Z' },
      { id: 'other', title: 'Other', updatedAt: '2026-05-13T01:00:00Z' },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
