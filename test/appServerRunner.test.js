import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { AppServerRunner } from '../src/appServerRunner.js';

function fakeAppServerConnection(script, assertEndpoint = () => {}) {
  const requests = [];
  const connectAppServer = async (endpoint) => {
    assertEndpoint(endpoint);
    const connection = new EventEmitter();
    connection.send = (value) => {
      const request = JSON.parse(value);
      requests.push(request);
      script({ request, connection, requests });
    };
    connection.close = () => {
      connection.closed = true;
    };
    return connection;
  };
  connectAppServer.requests = requests;
  return connectAppServer;
}

function fakeSpawn() {
  const spawned = [];
  const spawn = (command, args) => {
    spawned.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write() {} };
    child.kill = () => child.emit('close', 0);
    return child;
  };
  return { spawn, spawned };
}

function respond(connection, id, result) {
  connection.emit('message', JSON.stringify({ id, result }));
}

function notify(connection, method, params) {
  connection.emit('message', JSON.stringify({ method, params }));
}

test('probe succeeds when app-server websocket responds to thread/loaded/list', async () => {
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  });
  const { spawn } = fakeSpawn();
  const runner = new AppServerRunner({ connectAppServer, spawn, probeTimeoutMs: 50 });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(connectAppServer.requests.map((request) => request.method), ['initialize', 'thread/loaded/list']);
});

test('probe returns false when app-server websocket closes before responding', async () => {
  const connectAppServer = fakeAppServerConnection(({ connection }) => {
    connection.emit('close');
  });
  const { spawn } = fakeSpawn();
  const runner = new AppServerRunner({ connectAppServer, spawn, probeTimeoutMs: 50 });

  assert.equal(await runner.probe(), false);
});

test('starts a new app-server thread and captures the final assistant message', async () => {
  const events = [];
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/start') {
      respond(connection, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      assert.equal(request.params.threadId, 'thread-1');
      assert.deepEqual(request.params.input, [{ type: 'text', text: 'hello', text_elements: [] }]);
      respond(connection, request.id, { turn: { id: 'turn-1', items: [], status: 'completed' } });
      notify(connection, 'turn/started', { threadId: 'thread-1' });
      notify(connection, 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'done' });
      notify(connection, 'turn/completed', { threadId: 'thread-1' });
    }
  });
  const runner = new AppServerRunner({
    connectAppServer,
    spawn: fakeSpawn().spawn,
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    model: 'gpt-5.5',
  });

  const result = await runner.runNew('hello', { onProgress: (event) => events.push(event.type) });

  assert.equal(result.sessionId, 'thread-1');
  assert.equal(result.finalMessage, 'done');
  assert.deepEqual(events, ['thread.started', 'turn.started', 'agent_message.delta', 'turn.completed']);
  assert.equal(connectAppServer.requests.find((request) => request.method === 'thread/start').params.cwd, '/workspace');
  assert.equal(connectAppServer.requests.find((request) => request.method === 'thread/start').params.model, 'gpt-5.5');
});

test('resumes an app-server thread before starting a turn', async () => {
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/resume') {
      assert.equal(request.params.threadId, 'thread-1');
      respond(connection, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      respond(connection, request.id, { turn: { id: 'turn-1', items: [], status: 'completed' } });
      notify(connection, 'item/completed', {
        threadId: 'thread-1',
        item: { type: 'agentMessage', text: 'resumed' },
      });
      notify(connection, 'turn/completed', { threadId: 'thread-1' });
    }
  });
  const runner = new AppServerRunner({ connectAppServer, spawn: fakeSpawn().spawn, defaultCwd: '/workspace' });

  const result = await runner.resume('thread-1', 'continue');

  assert.equal(result.sessionId, 'thread-1');
  assert.equal(result.finalMessage, 'resumed');
  assert.deepEqual(connectAppServer.requests.map((request) => request.method), ['initialize', 'thread/resume', 'turn/start']);
});

test('treats a completed turn/start response as completion even without a notification', async () => {
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/start') {
      respond(connection, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      respond(connection, request.id, {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', id: 'item-1', text: 'response text' }],
        },
      });
    }
  });
  const runner = new AppServerRunner({ connectAppServer, spawn: fakeSpawn().spawn });

  const result = await runner.runNew('hello');

  assert.equal(result.finalMessage, 'response text');
  assert.equal(result.sessionId, 'thread-1');
});

test('starts a stdio app-server before connecting', async () => {
  const { spawn, spawned } = fakeSpawn();
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  }, (endpoint) => {
    assert.equal(endpoint.kind, 'stdio');
    assert.ok(endpoint.child);
  });
  const runner = new AppServerRunner({
    connectAppServer,
    codexCommand: 'codex',
    codexHome: '/tmp/codex-home',
    platform: 'darwin',
    spawn,
    startTimeoutMs: 50,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(spawned, [{ command: 'codex', args: ['app-server', '--analytics-default-enabled'] }]);
});

test('does not initialize the same app-server process twice after probe', async () => {
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
    if (request.method === 'thread/start') {
      respond(connection, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      respond(connection, request.id, {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', text: 'done' }],
        },
      });
    }
  });
  const runner = new AppServerRunner({
    connectAppServer,
    spawn: fakeSpawn().spawn,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  const result = await runner.runNew('hello');

  assert.equal(result.finalMessage, 'done');
  assert.deepEqual(connectAppServer.requests.map((request) => request.method), [
    'initialize',
    'thread/loaded/list',
    'thread/start',
    'turn/start',
  ]);
});

test('adds Codex app browser-use node_repl config when paths are provided', async () => {
  const { spawn, spawned } = fakeSpawn();
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  });
  const runner = new AppServerRunner({
    connectAppServer,
    codexCommand: '/Applications/Codex.app/Contents/Resources/codex',
    codexHome: '/tmp/codex-home',
    nodeReplPath: '/Applications/Codex.app/Contents/Resources/node_repl',
    nodePath: '/Applications/Codex.app/Contents/Resources/node',
    browserUseBackends: ['chrome', 'iab'],
    spawn,
    startTimeoutMs: 50,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  const args = spawned[0].args;
  assert.ok(args.includes('mcp_servers.node_repl.command="/Applications/Codex.app/Contents/Resources/node_repl"'));
  assert.ok(args.includes('mcp_servers.node_repl.env.NODE_REPL_NODE_PATH="/Applications/Codex.app/Contents/Resources/node"'));
  assert.ok(args.includes('mcp_servers.node_repl.env.CODEX_CLI_PATH="/Applications/Codex.app/Contents/Resources/codex"'));
  assert.ok(args.includes('mcp_servers.node_repl.env.NODE_REPL_REQUEST_META="{\\"x-codex-browser-use-available-backends\\":[\\"chrome\\",\\"iab\\"]}"'));
});
