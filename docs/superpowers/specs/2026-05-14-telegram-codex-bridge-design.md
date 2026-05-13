# Telegram Codex Bridge Design

## Goal

Build a lightweight Telegram bot bridge that runs Codex CLI commands directly, while keeping enough session state to continue or start Codex sessions explicitly.

## Approach

The bridge uses a command-first dispatch model. Telegram messages are accepted only from configured user IDs. Supported commands are `/new`, `/continue`, `/once`, `/attach`, `/sessions`, `/forget`, and `/status`. Non-command messages resume the chat's active Codex session when one exists; otherwise they create a new Codex session and bind it to the chat.

The first implementation avoids an LLM router. This keeps the front path short and predictable. A future version can add rule-based or LLM-assisted dispatch without changing the Codex runner interface.

## Components

- `src/router.js`: Parses Telegram text and decides the bridge action.
- `src/sessionStore.js`: Persists Telegram chat to active Codex session mappings.
- `src/codexSessions.js`: Reads and updates Codex's `session_index.jsonl` for recent sessions.
- `src/codexStateDb.js`: Optionally rewrites new Codex exec session metadata so those sessions appear in the Codex desktop app session list without forcing a tab switch.
- `src/codexRunner.js`: Spawns `codex exec` or `codex exec resume`, captures JSONL events and final output.
- `src/telegram.js`: Long-polls Telegram Bot API and sends replies.
- `src/index.js`: Wires configuration, Telegram polling, routing, and Codex execution.

## Safety

The bridge only accepts configured Telegram sender IDs. It uses an explicit default working directory configured by the operator. Codex sandbox and approval options are opt-in configuration values passed to Codex CLI. Secrets are read from environment variables or token files and are never written to logs.

## Testing

Unit tests cover routing, state persistence, and Codex session index parsing. The Codex runner is tested with injected child-process behavior so tests do not call the model. Manual smoke testing sends `/status` and `/once` through Telegram after configuration.
