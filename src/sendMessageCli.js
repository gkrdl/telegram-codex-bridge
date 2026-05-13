#!/usr/bin/env node
import { loadConfig, assertConfig } from './config.js';
import { TelegramClient } from './telegram.js';

async function main() {
  const args = process.argv.slice(2);
  const { dryRun, chatId, text } = parseArgs(args);

  if (!chatId || !text) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  assertConfig(config);

  if (!config.allowedUsers.includes(String(chatId))) {
    throw new Error(`Chat ${chatId} is not in allowedUsers.`);
  }

  if (dryRun) {
    process.stdout.write(JSON.stringify({
      chatId: String(chatId),
      text,
      configPath: config.configPath,
      sandboxMode: config.sandboxMode,
      approvalPolicy: config.approvalPolicy,
    }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const telegram = new TelegramClient({ token: config.telegramBotToken });
  const result = await telegram.sendMessage(chatId, text);
  process.stdout.write(JSON.stringify({
    ok: true,
    messageId: result.message_id,
    chatId: String(chatId),
  }, null, 2));
  process.stdout.write('\n');
}

function parseArgs(args) {
  let dryRun = false;
  let chatId = '';
  const parts = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--chat-id') {
      chatId = args[i + 1] ?? '';
      i += 1;
      continue;
    }
    parts.push(arg);
  }

  return {
    dryRun,
    chatId,
    text: parts.join(' ').trim(),
  };
}

function printUsage() {
  process.stderr.write('Usage: node src/sendMessageCli.js [--dry-run] --chat-id <id> <text>\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
