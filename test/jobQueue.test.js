import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionJobQueue } from '../src/jobQueue.js';

test('runs jobs for different sessions concurrently while serializing the same session', async () => {
  const queue = new SessionJobQueue();
  const events = [];
  let releaseFirst;
  const firstBlocker = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue({
    sessionKey: 'same',
    label: 'first',
    run: async () => {
      events.push('first:start');
      await firstBlocker;
      events.push('first:end');
      return 'first-result';
    },
  });
  const second = queue.enqueue({
    sessionKey: 'same',
    label: 'second',
    run: async () => {
      events.push('second:start');
      return 'second-result';
    },
  });
  const other = queue.enqueue({
    sessionKey: 'other',
    label: 'other',
    run: async () => {
      events.push('other:start');
      return 'other-result';
    },
  });

  await waitFor(() => events.includes('first:start') && events.includes('other:start'));
  assert.deepEqual(events, ['first:start', 'other:start']);

  releaseFirst();

  assert.equal(await first.promise, 'first-result');
  assert.equal(await second.promise, 'second-result');
  assert.equal(await other.promise, 'other-result');
  assert.deepEqual(events, ['first:start', 'other:start', 'first:end', 'second:start']);
});

async function waitFor(condition) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('condition was not met before timeout');
}
