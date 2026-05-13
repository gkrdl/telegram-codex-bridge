import { spawn as defaultSpawn } from 'node:child_process';

export function revealCodexThread(sessionId, { spawn = defaultSpawn } = {}) {
  const id = String(sessionId ?? '').trim();
  if (!id) {
    return false;
  }

  const child = spawn('open', [`codex://threads/${encodeURIComponent(id)}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref?.();
  return true;
}
