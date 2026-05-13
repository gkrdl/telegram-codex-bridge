import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { AppServerRunner } from '../src/appServerRunner.js';

function fakeAppServerSpawn(script, assertCommand = () => {}) {
  const requests = [];
  const spawn = (command, args, options) => {
    assertCommand(command, args, options);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write(value) {
        for (const line of String(value).split(/\r?\n/).filter(Boolean)) {
          const request = JSON.parse(line);
          requests.push(request);
          script({ request, child, requests });
        }
      },
      end() {
        child.stdinEnded = true;
      },
    };
    child.kill = () => {
      child.killed = true;
      child.emit('close', 0);
    };
    return child;
  };
  spawn.requests = requests;
  return spawn;
}

function respond(child, id, result) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id, result })}\n`));
}

function notify(child, method, params) {
  child.stdout.emit('data', Buffer.from(`${JSON.stringify({ method, params })}\n`));
}

test('probe succeeds when app-server proxy responds to thread/loaded/list', async () => {
  const spawn = fakeAppServerSpawn(({ request, child }) => {
    if (request.method === 'initialize') {
      respond(child, request.id, {});
    }
    if (request.method === 'thread/loaded/list') {
      respond(child, request.id, { data: [], nextCursor: null });
    }
  });
  const runner = new AppServerRunner({ spawn, codexCommand: 'codex', probeTimeoutMs: 50 });

  assert.equal(await runner.probe(), true);
  assert.deepEqual(spawn.requests.map((request) => request.method), ['initialize', 'thread/loaded/list']);
});

test('probe returns false when app-server proxy exits before responding', async () => {
  const spawn = fakeAppServerSpawn(({ child }) => {
    child.emit('close', 1);
  });
  const runner = new AppServerRunner({ spawn, codexCommand: 'codex', probeTimeoutMs: 50 });

  assert.equal(await runner.probe(), false);
});

test('starts a new app-server thread and captures the final assistant message', async () => {
  const events = [];
  const spawn = fakeAppServerSpawn(({ request, child }) => {
    if (request.method === 'initialize') {
      respond(child, request.id, {});
    }
    if (request.method === 'thread/start') {
      respond(child, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      assert.equal(request.params.threadId, 'thread-1');
      assert.deepEqual(request.params.input, [{ type: 'text', text: 'hello', text_elements: [] }]);
      respond(child, request.id, { turn: { id: 'turn-1', items: [], status: 'completed' } });
      notify(child, 'turn/started', { threadId: 'thread-1' });
      notify(child, 'item/agentMessage/delta', { threadId: 'thread-1', delta: 'done' });
      notify(child, 'turn/completed', { threadId: 'thread-1' });
    }
  });
  const runner = new AppServerRunner({
    spawn,
    codexCommand: 'codex',
    codexHome: '/home/user/.codex',
    defaultCwd: '/workspace',
    model: 'gpt-5.5',
  });

  const result = await runner.runNew('hello', { onProgress: (event) => events.push(event.type) });

  assert.equal(result.sessionId, 'thread-1');
  assert.equal(result.finalMessage, 'done');
  assert.deepEqual(events, ['thread.started', 'turn.started', 'agent_message.delta', 'turn.completed']);
  assert.equal(spawn.requests.find((request) => request.method === 'thread/start').params.cwd, '/workspace');
  assert.equal(spawn.requests.find((request) => request.method === 'thread/start').params.model, 'gpt-5.5');
});

test('resumes an app-server thread before starting a turn', async () => {
  const spawn = fakeAppServerSpawn(({ request, child }) => {
    if (request.method === 'initialize') {
      respond(child, request.id, {});
    }
    if (request.method === 'thread/resume') {
      assert.equal(request.params.threadId, 'thread-1');
      respond(child, request.id, { thread: { id: 'thread-1' } });
    }
    if (request.method === 'turn/start') {
      respond(child, request.id, { turn: { id: 'turn-1', items: [], status: 'completed' } });
      notify(child, 'item/completed', {
        threadId: 'thread-1',
        item: { type: 'agentMessage', text: 'resumed' },
      });
      notify(child, 'turn/completed', { threadId: 'thread-1' });
    }
  });
  const runner = new AppServerRunner({ spawn, codexCommand: 'codex', defaultCwd: '/workspace' });

  const result = await runner.resume('thread-1', 'continue');

  assert.equal(result.sessionId, 'thread-1');
  assert.equal(result.finalMessage, 'resumed');
  assert.deepEqual(spawn.requests.map((request) => request.method), ['initialize', 'thread/resume', 'turn/start']);
});
