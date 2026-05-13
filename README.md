# Telegram Codex Bridge

[English](#english) | [한국어](#한국어)

<a id="english"></a>

Telegram Codex Bridge is a small Node.js service that lets an allowlisted Telegram user start, resume, and inspect Codex CLI sessions from Telegram. It uses Telegram long polling, so it does not need a public webhook URL.

## Features

- Start persistent Codex sessions with `/new`.
- Resume the chat's active Codex session with `/continue` or plain text.
- Run ephemeral one-off tasks with `/once`.
- Attach Telegram to an existing Codex session with `/attach`.
- List recent Codex sessions with `/sessions`.
- Send outbound Telegram notifications from scripts or automations.
- Optionally make Codex app session metadata visible in the desktop app session list without forcing the app to switch tabs.

## Requirements

- Node.js 20 or newer.
- A working `codex` CLI on `PATH`, or a custom command set through config.
- A Telegram bot token from BotFather.
- Your Telegram numeric user ID or chat ID for the allowlist.
- `sqlite3` when using the optional Codex desktop session-list metadata rewrite.

## Install

```bash
git clone https://github.com/gkrdl/telegram-codex-bridge.git
cd telegram-codex-bridge
npm test
```

This project currently uses only Node built-ins, so there is no install step unless you add dependencies later.

## Configuration

Create `~/.config/telegram-codex-bridge/config.json`:

```json
{
  "telegramBotTokenFile": "~/.config/telegram-codex-bridge/telegram-bot-token",
  "allowedUsers": ["123456789"],
  "codexHome": "~/.codex",
  "defaultCwd": "~/projects",
  "model": "gpt-5.5",
  "skipGitRepoCheck": true,
  "sandboxMode": "danger-full-access",
  "approvalPolicy": "never",
  "stateFile": "~/.local/state/telegram-codex-bridge/state.json",
  "recentSessionLimit": 10,
  "pollTimeoutSeconds": 25,
  "revealNewSessionsInCodexApp": false
}
```

Store the bot token separately:

```bash
mkdir -p ~/.config/telegram-codex-bridge
chmod 700 ~/.config/telegram-codex-bridge
printf '%s' 'TELEGRAM_BOT_TOKEN_PLACEHOLDER' > ~/.config/telegram-codex-bridge/telegram-bot-token
chmod 600 ~/.config/telegram-codex-bridge/telegram-bot-token
```

Environment variables override the config file:

- `BRIDGE_CONFIG`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN_FILE`
- `TELEGRAM_ALLOWED_USERS`, comma-separated
- `CODEX_HOME`
- `BRIDGE_DEFAULT_CWD`
- `BRIDGE_STATE_FILE`
- `CODEX_COMMAND`
- `CODEX_MODEL`
- `CODEX_SKIP_GIT_REPO_CHECK`
- `CODEX_SANDBOX_MODE`
- `CODEX_APPROVAL_POLICY`
- `TELEGRAM_POLL_TIMEOUT`
- `BRIDGE_SESSION_LIMIT`
- `BRIDGE_REVEAL_CODEX_APP`

## Run

```bash
npm start
```

The bridge uses Telegram long polling. Do not run two long-polling consumers with the same bot token at the same time; Telegram updates may be delivered to only one of them.

## Telegram Commands

- `/new <prompt>` starts a new persistent Codex session and attaches this chat to it.
- `/continue <prompt>` resumes the active session for this chat.
- `/once <prompt>` runs an ephemeral one-off Codex task.
- `/sessions` lists recent Codex sessions from `session_index.jsonl`.
- `/attach <session-id-or-title>` attaches this chat to an existing session.
- `/forget` detaches this chat from the active Codex session.
- `/status` shows bridge state.
- `/help` shows command help.
- Plain text resumes the active session when attached; otherwise it starts a new session.

## Outbound Notifications

Reuse the bridge config and bot token for one-off notifications:

```bash
npm run send -- --chat-id 123456789 "Automation finished"
```

Dry run:

```bash
npm run send -- --dry-run --chat-id 123456789 "Automation finished"
```

## Codex Desktop Session List

Codex CLI sessions created through `codex exec` may not appear in the Codex desktop app session list immediately because their rollout metadata is marked as `source=exec`. This bridge can rewrite the new session's rollout metadata and app state database row to match desktop-visible session metadata.

That behavior is enabled by the bridge code when a new session is created. Keep `revealNewSessionsInCodexApp` set to `false` if you want the session list to update without switching the currently open Codex app tab.

Set `revealNewSessionsInCodexApp` to `true` only if you explicitly want the bridge to open `codex://threads/<id>` after starting a session.

## Security Notes

- Never commit `telegram-bot-token`, local `config.json`, or state files.
- Keep `allowedUsers` restricted to your own Telegram user ID or trusted users.
- `sandboxMode` and `approvalPolicy` are passed directly to Codex CLI. Choose values that match your risk tolerance.
- This bridge forwards Telegram prompts to Codex. Treat allowlisted Telegram access as local agent access.

## Test

```bash
npm test
```

## License

MIT

[Back to top](#telegram-codex-bridge)

---

<a id="한국어"></a>

# Telegram Codex Bridge 한국어

[English](#english) | [한국어](#한국어)

Telegram Codex Bridge는 Telegram에서 Codex CLI 세션을 시작하고 이어갈 수 있게 해주는 작은 Node.js 서비스입니다. Telegram long polling을 사용하므로 공개 webhook URL이 필요 없습니다.

## 주요 기능

- `/new`로 지속 Codex 세션 시작.
- `/continue` 또는 일반 메시지로 현재 연결된 Codex 세션 이어가기.
- `/once`로 저장되지 않는 1회성 작업 실행.
- `/attach`로 기존 Codex 세션에 Telegram 채팅 연결.
- `/sessions`로 최근 Codex 세션 목록 확인.
- 스크립트나 자동화에서 Telegram 알림 발송.
- Codex desktop 앱 세션 리스트에 bridge-created 세션이 보이도록 metadata 보정.

## 요구사항

- Node.js 20 이상.
- `PATH`에서 실행 가능한 `codex` CLI, 또는 config의 `codexCommand`.
- BotFather에서 만든 Telegram bot token.
- allowlist에 넣을 Telegram 숫자 user ID 또는 chat ID.
- Codex desktop 세션 리스트 metadata 보정을 사용할 경우 `sqlite3`.

## 설치

```bash
git clone https://github.com/gkrdl/telegram-codex-bridge.git
cd telegram-codex-bridge
npm test
```

현재는 Node 내장 모듈만 사용하므로 별도 dependency 설치가 필요 없습니다.

## 설정

`~/.config/telegram-codex-bridge/config.json`을 만듭니다:

```json
{
  "telegramBotTokenFile": "~/.config/telegram-codex-bridge/telegram-bot-token",
  "allowedUsers": ["123456789"],
  "codexHome": "~/.codex",
  "defaultCwd": "~/projects",
  "model": "gpt-5.5",
  "skipGitRepoCheck": true,
  "sandboxMode": "danger-full-access",
  "approvalPolicy": "never",
  "stateFile": "~/.local/state/telegram-codex-bridge/state.json",
  "recentSessionLimit": 10,
  "pollTimeoutSeconds": 25,
  "revealNewSessionsInCodexApp": false
}
```

bot token은 별도 파일에 저장합니다:

```bash
mkdir -p ~/.config/telegram-codex-bridge
chmod 700 ~/.config/telegram-codex-bridge
printf '%s' 'TELEGRAM_BOT_TOKEN_PLACEHOLDER' > ~/.config/telegram-codex-bridge/telegram-bot-token
chmod 600 ~/.config/telegram-codex-bridge/telegram-bot-token
```

환경변수는 config 파일보다 우선합니다:

- `BRIDGE_CONFIG`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_TOKEN_FILE`
- `TELEGRAM_ALLOWED_USERS`, 쉼표 구분
- `CODEX_HOME`
- `BRIDGE_DEFAULT_CWD`
- `BRIDGE_STATE_FILE`
- `CODEX_COMMAND`
- `CODEX_MODEL`
- `CODEX_SKIP_GIT_REPO_CHECK`
- `CODEX_SANDBOX_MODE`
- `CODEX_APPROVAL_POLICY`
- `TELEGRAM_POLL_TIMEOUT`
- `BRIDGE_SESSION_LIMIT`
- `BRIDGE_REVEAL_CODEX_APP`

## 실행

```bash
npm start
```

같은 bot token으로 long polling consumer를 두 개 이상 동시에 실행하지 마세요. Telegram update가 한쪽으로만 전달될 수 있습니다.

## Telegram 명령어

- `/new <내용>`: 새 지속 Codex 세션을 시작하고 이 채팅에 연결합니다.
- `/continue <내용>`: 현재 연결된 세션을 이어갑니다.
- `/once <내용>`: 저장되지 않는 1회성 Codex 작업을 실행합니다.
- `/sessions`: `session_index.jsonl`에서 최근 세션 목록을 보여줍니다.
- `/attach <세션ID 또는 제목>`: 기존 세션에 이 채팅을 연결합니다.
- `/forget`: 현재 세션 연결을 해제합니다.
- `/status`: bridge 상태를 보여줍니다.
- `/help`: 도움말을 보여줍니다.
- 일반 메시지: 연결된 세션이 있으면 이어가고, 없으면 새 세션을 시작합니다.

## 알림 보내기

bridge 설정과 bot token을 재사용해 단발성 Telegram 알림을 보낼 수 있습니다:

```bash
npm run send -- --chat-id 123456789 "자동화 완료"
```

dry run:

```bash
npm run send -- --dry-run --chat-id 123456789 "자동화 완료"
```

## Codex Desktop 세션 리스트

`codex exec`로 만들어진 Codex CLI 세션은 rollout metadata가 `source=exec`로 기록되어 Codex desktop 앱 세션 리스트에 바로 보이지 않을 수 있습니다. 이 bridge는 새 세션 생성 시 rollout metadata와 app state DB row를 desktop 앱에서 보이는 세션 형태로 보정합니다.

현재 열려 있는 Codex 앱 탭을 건드리지 않고 세션 리스트만 갱신하려면 `revealNewSessionsInCodexApp`를 `false`로 유지하세요.

`revealNewSessionsInCodexApp`를 `true`로 설정하면 세션 생성 후 `codex://threads/<id>`를 열어 Codex 앱이 해당 세션으로 전환될 수 있습니다.

## 보안 메모

- `telegram-bot-token`, 로컬 `config.json`, state 파일을 commit하지 마세요.
- `allowedUsers`는 본인 또는 신뢰하는 Telegram user ID로 제한하세요.
- `sandboxMode`, `approvalPolicy`는 Codex CLI에 그대로 전달됩니다. 위험 허용 범위에 맞춰 선택하세요.
- 이 bridge는 Telegram prompt를 Codex에 전달합니다. allowlist에 들어간 Telegram 접근은 로컬 agent 접근과 비슷하게 취급해야 합니다.

## 테스트

```bash
npm test
```

## 라이선스

MIT

[맨 위로](#telegram-codex-bridge)
