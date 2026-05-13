import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readRecentSessions } from '../src/codexSessions.js';

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
