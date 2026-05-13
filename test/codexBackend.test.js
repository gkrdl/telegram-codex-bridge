import test from 'node:test';
import assert from 'node:assert/strict';

import { createCodexBackend } from '../src/codexBackend.js';

class FakeRunner {
  constructor(name, reachable) {
    this.name = name;
    this.reachable = reachable;
  }

  async probe() {
    return this.reachable;
  }
}

test('selects app-server backend when probe succeeds', async () => {
  const backend = await createCodexBackend({
    appServerRunner: new FakeRunner('app-server', true),
    execRunner: new FakeRunner('exec', true),
    logger: noopLogger(),
  });

  assert.equal(backend.name, 'app-server');
});

test('falls back to exec backend when app-server probe fails', async () => {
  const backend = await createCodexBackend({
    appServerRunner: new FakeRunner('app-server', false),
    execRunner: new FakeRunner('exec', true),
    logger: noopLogger(),
  });

  assert.equal(backend.name, 'exec');
});

test('falls back to exec backend when app-server probe throws', async () => {
  const appServerRunner = new FakeRunner('app-server', true);
  appServerRunner.probe = async () => {
    throw new Error('no socket');
  };

  const backend = await createCodexBackend({
    appServerRunner,
    execRunner: new FakeRunner('exec', true),
    logger: noopLogger(),
  });

  assert.equal(backend.name, 'exec');
});

function noopLogger() {
  return { log() {}, error() {} };
}
