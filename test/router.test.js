import test from 'node:test';
import assert from 'node:assert/strict';

import { helpText, routeMessage } from '../src/router.js';

test('routes /new to a new persistent Codex session', () => {
  assert.deepEqual(routeMessage('/new build the bridge', { activeSessionId: 'old' }), {
    action: 'new',
    prompt: 'build the bridge',
  });
});

test('routes /continue to active session resume', () => {
  assert.deepEqual(routeMessage('/continue keep going', { activeSessionId: 'abc' }), {
    action: 'resume',
    sessionId: 'abc',
    prompt: 'keep going',
  });
});

test('asks for an active session when /continue has no binding', () => {
  assert.deepEqual(routeMessage('/continue keep going', {}), {
    action: 'reply',
    text: 'No active Codex session is attached. Use /new, /attach, or send a new message to start one.',
  });
});

test('routes /once to ephemeral execution', () => {
  assert.deepEqual(routeMessage('/once what is the time?', { activeSessionId: 'abc' }), {
    action: 'once',
    prompt: 'what is the time?',
  });
});

test('defaults to resume when active session exists', () => {
  assert.deepEqual(routeMessage('keep editing it', { activeSessionId: 'abc' }), {
    action: 'resume',
    sessionId: 'abc',
    prompt: 'keep editing it',
  });
});

test('defaults to new when active session is missing', () => {
  assert.deepEqual(routeMessage('start something', {}), {
    action: 'new',
    prompt: 'start something',
  });
});

test('routes /attach with a session id', () => {
  assert.deepEqual(routeMessage('/attach 019e21d8-0d39-7ac3-8433-384449487aed', {}), {
    action: 'attach',
    sessionId: '019e21d8-0d39-7ac3-8433-384449487aed',
  });
});

test('help text is localized in Korean', () => {
  const text = helpText();
  assert.match(text, /명령어/);
  assert.match(text, /새 Codex 세션/);
  assert.match(text, /일반 메시지/);
});
