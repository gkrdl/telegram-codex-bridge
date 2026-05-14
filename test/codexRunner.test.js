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
      assert.deepEqual(args, ['exec', '--json', '-C', '/workspace', '-']);
      assert.equal(options.env.CODEX_HOME, '/home/user/.codex');
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  assert.equal((await runner.runNew('hello')).finalMessage, 'done');
});

test('resumes an existing Codex session', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', 'resume', 'abc', '--json', '-']);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  assert.equal((await runner.resume('abc', 'continue')).finalMessage, 'done');
});

test('runs a one-off ephemeral Codex exec', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--ephemeral', '-C', '/workspace', '-']);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  assert.equal((await runner.runOnce('quick')).finalMessage, 'done');
});

test('adds skip git repo check when configured', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--skip-git-repo-check', '-C', '/workspace', '-']);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    skipGitRepoCheck: true,
  });

  assert.equal((await runner.runNew('hello')).finalMessage, 'done');
});

test('adds sandbox and approval config when configured', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, [
        'exec',
        'resume',
        'abc',
        '--json',
        '-c',
        'sandbox_mode="danger-full-access"',
        '-c',
        'approval_policy="never"',
        '-',
      ]);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  });

  assert.equal((await runner.resume('abc', 'continue')).finalMessage, 'done');
});

test('adds browser-use node_repl config to Codex exec when configured', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, [
        'exec',
        '--json',
        '-c',
        'features.js_repl=false',
        '-c',
        'mcp_servers.node_repl.command="/Applications/Codex.app/Contents/Resources/node_repl"',
        '-c',
        'mcp_servers.node_repl.args=[]',
        '-c',
        'mcp_servers.node_repl.startup_timeout_sec=120',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS="1000"',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_NODE_MODULE_DIRS=""',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_NODE_PATH="/Applications/Codex.app/Contents/Resources/node"',
        '-c',
        'mcp_servers.node_repl.env.CODEX_HOME="/home/user/.codex"',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_REQUEST_META="{\\"x-codex-browser-use-available-backends\\":[\\"chrome\\",\\"iab\\"]}"',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S="9990b9b3defcd92659e0d88c4cf847d97c64c0af047c4a24266821711c24749e"',
        '-c',
        'mcp_servers.node_repl.env.NODE_REPL_BROWSER_CLIENT_MARKETPLACE_NAME="openai-bundled"',
        '-c',
        'mcp_servers.node_repl.env.CODEX_CLI_PATH="/Applications/Codex.app/Contents/Resources/codex"',
        '-C',
        '/workspace',
        '-',
      ]);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    browserUseRuntime: {
      codexCliPath: '/Applications/Codex.app/Contents/Resources/codex',
      nodeReplPath: '/Applications/Codex.app/Contents/Resources/node_repl',
      nodePath: '/Applications/Codex.app/Contents/Resources/node',
      backends: ['chrome', 'iab'],
    },
  });

  assert.equal((await runner.runNew('hello')).finalMessage, 'done');
});

test('skips browser-use node_repl config when disabled per run', async () => {
  const runner = new CodexRunner({
    spawn: fakeSpawn((command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '-C', '/workspace', '-']);
    }),
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    browserUseRuntime: {
      codexCliPath: '/Applications/Codex.app/Contents/Resources/codex',
      nodeReplPath: '/Applications/Codex.app/Contents/Resources/node_repl',
      nodePath: '/Applications/Codex.app/Contents/Resources/node',
      backends: ['chrome', 'iab'],
    },
  });

  assert.equal((await runner.runNew('hello', { browserUseEnabled: false })).finalMessage, 'done');
});

test('extracts assistant text from Codex item.completed agent_message events', async () => {
  const runner = new CodexRunner({
    spawn: (command, args) => {
      assert.equal(command, 'codex');
      assert.deepEqual(args, ['exec', '--json', '--ephemeral', '-C', '/workspace', '-']);
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
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  assert.equal((await runner.runOnce('quick')).finalMessage, '안녕');
});

test('emits progress events while reading Codex JSONL', async () => {
  const events = [];
  const runner = new CodexRunner({
    spawn: (command, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {} };
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'thread.started', thread_id: 't' }) + '\n'));
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'turn.started' }) + '\n'));
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }) + '\n'));
        child.emit('close', 0);
      });
      return child;
    },
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  const result = await runner.runOnce('quick', { onProgress: (event) => events.push(event.type) });
  assert.equal(result.finalMessage, 'done');
  assert.deepEqual(events, ['thread.started', 'turn.started', 'item.completed']);
});

test('returns new thread id from Codex progress events', async () => {
  const runner = new CodexRunner({
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end() {} };
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from([
          JSON.stringify({ type: 'thread.started', thread_id: 'session-123' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'done' }),
          '',
        ].join('\n')));
        child.emit('close', 0);
      });
      return child;
    },
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
  });

  const result = await runner.runNew('hello');

  assert.equal(result.sessionId, 'session-123');
});
