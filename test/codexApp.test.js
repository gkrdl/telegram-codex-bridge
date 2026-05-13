import test from 'node:test';
import assert from 'node:assert/strict';

import { revealCodexThread } from '../src/codexApp.js';

test('reveals a Codex thread through the desktop deep link', () => {
  let unrefCalled = false;
  const calls = [];

  const didReveal = revealCodexThread('session-123', {
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return {
        unref() {
          unrefCalled = true;
        },
      };
    },
  });

  assert.equal(didReveal, true);
  assert.deepEqual(calls, [{
    command: 'open',
    args: ['codex://threads/session-123'],
    options: {
      detached: true,
      stdio: 'ignore',
    },
  }]);
  assert.equal(unrefCalled, true);
});

test('skips Codex app reveal without a session id', () => {
  const didReveal = revealCodexThread('', {
    spawn() {
      throw new Error('spawn should not be called');
    },
  });

  assert.equal(didReveal, false);
});
