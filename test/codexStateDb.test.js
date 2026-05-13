import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { markThreadInteractive } from '../src/codexStateDb.js';

test('marks Codex exec threads as desktop-visible sessions', async () => {
  const calls = [];
  const didMark = await markThreadInteractive('/home/user/.codex', '019e22c2-be13-7be2-9ff6-de15de5fe779', {
    async execFile(command, args) {
      calls.push({ command, args });
      return { stdout: '' };
    },
  });

  assert.equal(didMark, true);
  assert.deepEqual(calls, [{
    command: 'sqlite3',
    args: [
      '-noheader',
      '/home/user/.codex/state_5.sqlite',
      "SELECT rollout_path FROM threads WHERE id='019e22c2-be13-7be2-9ff6-de15de5fe779' LIMIT 1;",
    ],
  }, {
    command: 'sqlite3',
    args: [
      '/home/user/.codex/state_5.sqlite',
      "UPDATE threads SET source='vscode', thread_source=NULL WHERE id='019e22c2-be13-7be2-9ff6-de15de5fe779' AND source IN ('exec', 'cli');",
    ],
  }]);
});

test('rewrites rollout session_meta source when the file can be found', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'telegram-codex-state-'));
  try {
    const codexHome = join(dir, '.codex');
    const sessionsDir = join(codexHome, 'sessions', '2026', '05', '14');
    await mkdir(sessionsDir, { recursive: true });
    const threadId = '019e22c2-be13-7be2-9ff6-de15de5fe779';
    const rolloutPath = join(sessionsDir, `rollout-2026-05-14T04-14-08-${threadId}.jsonl`);
    await writeFile(rolloutPath, [
      JSON.stringify({
        timestamp: '2026-05-13T19:14:13.004Z',
        type: 'session_meta',
        payload: {
          id: threadId,
          originator: 'codex_exec',
          source: 'exec',
        },
      }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message' } }),
      '',
    ].join('\n'));

    await markThreadInteractive(codexHome, threadId, {
      async execFile(command, args) {
        if (args[0] === '-noheader') {
          return { stdout: `${rolloutPath}\n` };
        }
        return { stdout: '' };
      },
    });

    const firstLine = (await readFile(rolloutPath, 'utf8')).split('\n')[0];
    const event = JSON.parse(firstLine);
    assert.equal(event.payload.source, 'vscode');
    assert.equal(event.payload.originator, 'Codex Desktop');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses invalid thread ids before building SQL', async () => {
  const didMark = await markThreadInteractive('/home/user/.codex', "bad'id", {
    async execFile() {
      throw new Error('execFile should not be called');
    },
  });

  assert.equal(didMark, false);
});
