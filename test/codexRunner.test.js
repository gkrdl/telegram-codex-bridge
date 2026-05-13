import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { CodexRunner } from '../src/codexRunner.js';

function fakeSpawn(assertCommand) {
  return (command, args, options) => {
    assertCommand(command, args, options);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      end(value) {
        child.stdinValue = value;
      },
    };
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'message', role: 'assistant', content: 'done' }) + '\n'));
      child.emit('close', 0);
    });
    return child;
  };
}

test('runs a new persistent Codex exec session', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args, options) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '-C', '/Users/hak', '-']);
      assert.equal(options.env.CODEX_HOME, '/Users/hak/.codex');
    }),
    codexHome: '/Users/hak/.codex',
    defaultCwd: '/Users/hak',
  });

  assert.equal((await runner.runNew('hello')).finalMessage, 'done');
});

test('resumes an existing Codex session', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', 'resume', 'abc', '--json', '-']);
    }),
    codexHome: '/Users/hak/.codex',
    defaultCwd: '/Users/hak',
  });

  assert.equal((await runner.resume('abc', 'continue')).finalMessage, 'done');
});

test('runs a one-off ephemeral Codex exec', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--ephemeral', '-C', '/Users/hak', '-']);
    }),
    codexHome: '/Users/hak/.codex',
    defaultCwd: '/Users/hak',
  });

  assert.equal((await runner.runOnce('quick')).finalMessage, 'done');
});

test('adds skip git repo check when configured', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', '-C', '/Users/hak', '-']);
    }),
    codexHome: '/Users/hak/.codex',
    defaultCwd: '/Users/hak',
    skipGitRepoCheck: true,
  });

  assert.equal((await runner.runNew('hello')).finalMessage, 'done');
});

test('extracts assistant text from Codex item.completed agent_message events', async () => {
  const runner = new CodexRunner({
    spawn: (command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--ephemeral', '-C', '/Users/hak', '-']);
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {} };
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from([
          JSON.stringify({ type: 'thread.started', thread_id: 't' }),
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '안녕' } }),
          JSON.stringify({ type: 'turn.completed' }),
          '',
        ].join('\n')));
        child.emit('close', 0);
      });
      return child;
    },
    codexHome: '/Users/hak/.codex',
    defaultCwd: '/Users/hak',
  });

  assert.equal((await runner.runOnce('quick')).finalMessage, '안녕');
});
