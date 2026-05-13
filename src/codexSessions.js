import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readRecentSessions(codexHome, limit = 10) {
  const indexPath = join(codexHome, 'session_index.jsonl');
  let raw;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => parseSessionLine(line))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

export async function findSession(codexHome, needle) {
  const sessions = await readRecentSessions(codexHome, 100);
  const query = String(needle ?? '').trim().toLowerCase();
  if (!query) {
    return null;
  }

  return sessions.find((session) => session.id === needle)
    ?? sessions.find((session) => session.title.toLowerCase() === query)
    ?? sessions.find((session) => session.title.toLowerCase().includes(query))
    ?? null;
}

function parseSessionLine(line) {
  try {
    const item = JSON.parse(line);
    if (!item?.id) {
      return null;
    }
    return {
      id: item.id,
      title: item.thread_name || item.id,
      updatedAt: item.updated_at || '',
    };
  } catch {
    return null;
  }
}
