import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export async function loadConfig() {
  const configPath = process.env.BRIDGE_CONFIG || resolve(homedir(), '.config/telegram-codex-bridge/config.json');
  const fileConfig = await readJsonIfExists(configPath);
  const tokenFile = process.env.TELEGRAM_BOT_TOKEN_FILE || fileConfig.telegramBotTokenFile;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
    || fileConfig.telegramBotToken
    || (tokenFile ? (await readFile(expandHome(tokenFile), 'utf8')).trim() : '');

  const allowedUsers = parseList(process.env.TELEGRAM_ALLOWED_USERS)
    ?? parseList(fileConfig.allowedUsers)
    ?? [];

  return {
    configPath,
    telegramBotToken,
    allowedUsers: allowedUsers.map(String),
    codexHome: expandHome(process.env.CODEX_HOME || fileConfig.codexHome || '~/.codex'),
    stateFile: expandHome(process.env.BRIDGE_STATE_FILE || fileConfig.stateFile || '~/.local/state/telegram-codex-bridge/state.json'),
    defaultCwd: expandHome(process.env.BRIDGE_DEFAULT_CWD || fileConfig.defaultCwd || homedir()),
    codexCommand: process.env.CODEX_COMMAND || fileConfig.codexCommand || 'codex',
    model: process.env.CODEX_MODEL || fileConfig.model || '',
    skipGitRepoCheck: parseBoolean(process.env.CODEX_SKIP_GIT_REPO_CHECK, fileConfig.skipGitRepoCheck ?? false),
    pollTimeoutSeconds: Number(process.env.TELEGRAM_POLL_TIMEOUT || fileConfig.pollTimeoutSeconds || 25),
    recentSessionLimit: Number(process.env.BRIDGE_SESSION_LIMIT || fileConfig.recentSessionLimit || 10),
  };
}

export function assertConfig(config) {
  if (!config.telegramBotToken) {
    throw new Error('Missing Telegram bot token. Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_TOKEN_FILE, or config.telegramBotTokenFile.');
  }
  if (config.allowedUsers.length === 0) {
    throw new Error('Missing Telegram allowlist. Set TELEGRAM_ALLOWED_USERS or config.allowedUsers.');
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(expandHome(path), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return null;
}

function expandHome(path) {
  if (!path) {
    return path;
  }
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function parseBoolean(envValue, defaultValue) {
  if (envValue === undefined) {
    return Boolean(defaultValue);
  }
  return ['1', 'true', 'yes', 'on'].includes(String(envValue).toLowerCase());
}
