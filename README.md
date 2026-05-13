# Telegram Codex Bridge

A lightweight Telegram bot bridge for running Codex CLI directly.

## Commands

- `/new <prompt>` starts a new persistent Codex session and attaches this chat to it.
- `/continue <prompt>` resumes the active session for this chat.
- `/once <prompt>` runs an ephemeral one-off Codex task.
- `/sessions` lists recent Codex sessions from `session_index.jsonl`.
- `/attach <session-id-or-title>` attaches this chat to an existing session.
- `/forget` detaches this chat from the active session.
- `/status` shows bridge state.
- Plain text resumes the active session when attached; otherwise it starts a new session.

## Configure

Create `~/.config/telegram-codex-bridge/config.json`:

```json
{
  "telegramBotTokenFile": "/Users/hak/.openclaw/secrets/telegram-bot-token",
  "allowedUsers": ["8183683727"],
  "codexHome": "/Users/hak/.codex",
  "defaultCwd": "/Users/hak",
  "stateFile": "/Users/hak/.local/state/telegram-codex-bridge/state.json"
}
```

Environment variables override the file:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN_FILE`
- `TELEGRAM_ALLOWED_USERS` comma-separated
- `CODEX_HOME`
- `BRIDGE_DEFAULT_CWD`
- `BRIDGE_STATE_FILE`
- `CODEX_MODEL`
- `CODEX_COMMAND`

## Run

```bash
npm test
npm start
```

The bridge uses Telegram long polling and does not require a public webhook URL.

Do not run this bridge and OpenClaw against the same Telegram bot token at the same time. Telegram long polling delivers each update to one consumer, so concurrent consumers can steal messages from each other. Use a separate BotFather bot for this bridge, or stop OpenClaw's Telegram channel before starting this bridge with the shared token.
