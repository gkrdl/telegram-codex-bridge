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
  const runner = new AppServerRunner({ connectAppServer, existsSync: () => true, probeTimeoutMs: 50 });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(connectAppServer.requests.map((request) => request.method), ['initialize', 'thread/loaded/list']);
});

test('probe returns false when app-server websocket closes before responding', async () => {
  const connectAppServer = fakeAppServerConnection(({ connection }) => {
    connection.emit('close');
  });
  const runner = new AppServerRunner({ connectAppServer, existsSync: () => true, probeTimeoutMs: 50 });

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
    existsSync: () => true,
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
  const runner = new AppServerRunner({ connectAppServer, existsSync: () => true, defaultCwd: '/workspace' });

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
  const runner = new AppServerRunner({ connectAppServer, existsSync: () => true });

  const result = await runner.runNew('hello');

  assert.equal(result.finalMessage, 'response text');
  assert.equal(result.sessionId, 'thread-1');
});

test('starts a Unix socket app-server on macOS/Linux before connecting', async () => {
  const spawned = [];
  let socketExists = false;
  const spawn = (command, args) => {
    spawned.push({ command, args });
    socketExists = true;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 0);
    return child;
  };
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  }, (endpoint) => {
    assert.equal(endpoint.kind, 'unix');
    assert.equal(endpoint.socketPath, '/tmp/codex-home/app-server-control/app-server-control.sock');
  });
  const runner = new AppServerRunner({
    connectAppServer,
    codexCommand: 'codex',
    codexHome: '/tmp/codex-home',
    existsSync: () => socketExists,
    platform: 'darwin',
    spawn,
    startTimeoutMs: 50,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(spawned, [{ command: 'codex', args: ['app-server', '--listen', 'unix://'] }]);
});

test('restarts Unix app-server when a cached socket endpoint disappeared', async () => {
  const spawned = [];
  let socketExists = true;
  const spawn = (command, args) => {
    spawned.push({ command, args });
    socketExists = true;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 0);
    return child;
  };
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  }, () => {
    if (!socketExists) {
      const error = new Error('connect ENOENT /tmp/codex-home/app-server-control/app-server-control.sock');
      error.code = 'ENOENT';
      throw error;
    }
  });
  const runner = new AppServerRunner({
    connectAppServer,
    codexCommand: 'codex',
    codexHome: '/tmp/codex-home',
    existsSync: () => socketExists,
    platform: 'darwin',
    spawn,
    startTimeoutMs: 50,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  socketExists = false;
  assert.equal(await runner.probe(), true);
  assert.deepEqual(spawned, [{ command: 'codex', args: ['app-server', '--listen', 'unix://'] }]);
});

test('starts a localhost websocket app-server on Windows before connecting', async () => {
  const spawned = [];
  const spawn = (command, args) => {
    spawned.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit('close', 0);
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('listening on: ws://127.0.0.1:32123\n'));
    });
    return child;
  };
  const connectAppServer = fakeAppServerConnection(({ request, connection }) => {
    if (request.method === 'initialize') {
      respond(connection, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(connection, request.id, { data: [], nextCursor: null });
    }
  }, (endpoint) => {
    assert.equal(endpoint.kind, 'websocket');
    assert.equal(endpoint.url, 'ws://127.0.0.1:32123/rpc');
  });
  const runner = new AppServerRunner({
    connectAppServer,
    codexCommand: 'codex',
    platform: 'win32',
    spawn,
    startTimeoutMs: 50,
    probeTimeoutMs: 50,
  });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(spawned, [{ command: 'codex', args: ['app-server', '--listen', 'ws://127.0.0.1:0'] }]);
});
