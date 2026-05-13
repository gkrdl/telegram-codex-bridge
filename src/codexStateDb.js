import { execFile as defaultExecFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(defaultExecFile);

export async function markThreadInteractive(codexHome, threadId, { execFile = execFileAsync } = {}) {
  const id = String(threadId ?? '').trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return false;
  }

  const rolloutPath = await findRolloutPath(codexHome, id, { execFile });
  if (rolloutPath) {
    await rewriteSessionMetaSource(rolloutPath, id);
  }

  const dbPath = join(codexHome, 'state_5.sqlite');
  const sql = [
    'UPDATE threads',
    "SET source='vscode', thread_source=NULL",
    `WHERE id='${id}' AND source IN ('exec', 'cli');`,
  ].join(' ');
  await execFile('sqlite3', [dbPath, sql]);
  return true;
}

async function findRolloutPath(codexHome, threadId, { execFile }) {
  const dbPath = join(codexHome, 'state_5.sqlite');
  try {
    const { stdout } = await execFile('sqlite3', [
      '-noheader',
      dbPath,
      `SELECT rollout_path FROM threads WHERE id='${threadId}' LIMIT 1;`,
    ]);
    const path = stdout.trim();
    if (path) {
      return path;
    }
  } catch {
    // The app may not have inserted the thread row yet; fall back to disk scan.
  }

  return findRolloutPathOnDisk(join(codexHome, 'sessions'), threadId);
}

async function findRolloutPathOnDisk(root, threadId) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return '';
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findRolloutPathOnDisk(path, threadId);
      if (found) {
        return found;
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) {
      return path;
    }
  }
  return '';
}

async function rewriteSessionMetaSource(rolloutPath, threadId) {
  const raw = await readFile(rolloutPath, 'utf8');
  const newlineIndex = raw.indexOf('\n');
  const firstLine = newlineIndex === -1 ? raw : raw.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? '' : raw.slice(newlineIndex + 1);
  const firstEvent = JSON.parse(firstLine);

  if (firstEvent?.type !== 'session_meta' || firstEvent.payload?.id !== threadId) {
    return;
  }
  firstEvent.payload.source = 'vscode';
  firstEvent.payload.originator = 'Codex Desktop';

  const next = `${JSON.stringify(firstEvent)}\n${rest}`;
  if (next !== raw) {
    await writeFile(rolloutPath, next, 'utf8');
  }
}
