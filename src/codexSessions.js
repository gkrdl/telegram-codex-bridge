import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

export async function upsertSessionIndex(codexHome, { id, title, updatedAt = new Date().toISOString() }) {
  if (!id) {
    return;
  }

  const indexPath = join(codexHome, 'session_index.jsonl');
  let lines = [];
  try {
    const raw = await readFile(indexPath, 'utf8');
    lines = raw.split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    await mkdir(codexHome, { recursive: true });
  }

  const nextEntry = {
    id,
    thread_name: title || id,
    updated_at: updatedAt,
  };
  const kept = lines.filter((line) => {
    const item = safeParseSessionLine(line);
    return !item || item.id !== id;
  });
  kept.push(JSON.stringify(nextEntry));
  await writeFile(indexPath, `${kept.join('\n')}\n`, 'utf8');
}

function parseSessionLine(line) {
  try {
    const item = parseRawSessionLine(line);
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

function parseRawSessionLine(line) {
  return JSON.parse(line);
}

function safeParseSessionLine(line) {
  try {
    return parseRawSessionLine(line);
  } catch {
    return null;
  }
}
