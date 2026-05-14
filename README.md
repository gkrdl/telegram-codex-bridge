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
- Run Codex through `codex exec` for predictable CLI-compatible behavior.
- Run multiple Codex jobs concurrently across different sessions while serializing turns for the same session.
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
  "browserUseMode": "auto",
  "stateFile": "~/.local/state/telegram-codex-bridge/state.json",
  "recentSessionLimit": 10,
  "pollTimeoutSeconds": 25
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
- `BRIDGE_BROWSER_USE_MODE` (`auto`, `always`, or `never`)
- `TELEGRAM_POLL_TIMEOUT`
- `BRIDGE_SESSION_LIMIT`

## Run

```bash
npm start
```

The bridge uses Telegram long polling. Do not run two long-polling consumers with the same bot token at the same time; Telegram updates may be delivered to only one of them.

The bridge runs Codex through the normal `codex exec` backend. It does not start or probe a Codex app-server process. When the macOS Codex app bundle is installed at `/Applications/Codex.app`, the bridge can pass the app-bundled `node_repl` runtime to `codex exec` so Browser Use/Chrome extension automation can be bootstrapped from Codex skills. `browserUseMode` controls when that runtime is injected: `auto` injects it only for browser-looking prompts, `always` preserves the old eager behavior, and `never` disables it.

Codex prompts are scheduled as background jobs, so the bridge can continue accepting Telegram commands while a prompt is still running. Jobs for different Codex sessions may run at the same time. Multiple turns targeting the same session are queued and executed in order to avoid corrupting session state.

Bridge responses are sent as replies to the original Telegram message, which makes concurrent job output easier to match to the prompt that started it.

## Telegram Commands

- `/new <prompt>` starts a new persistent Codex session and attaches this chat to it.
- `/continue <prompt>` resumes the active session for this chat.
- `/once <prompt>` runs an ephemeral one-off Codex task.
- `/sessions` lists recent Codex sessions from `session_index.jsonl`.
- `/attach <session-id-or-title>` attaches this chat to an existing session.
- `/forget` detaches this chat from the active Codex session.
- `/status` shows bridge state and queued/running jobs.
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

That behavior is enabled by the bridge code when a new session is created. The bridge does not open `codex://threads/<id>`, so it can update the session list without switching the currently open Codex app tab.

## Security Notes

- Never commit `telegram-bot-token`, local `config.json`, or state files.
- Keep `allowedUsers` restricted to your own Telegram user ID or trusted users.
- `sandboxMode` and `approvalPolicy` are passed directly to Codex. Choose values that match your risk tolerance.
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
- 예측 가능한 CLI 호환 동작을 위해 `codex exec`로 Codex 실행.
- 서로 다른 Codex 세션의 작업은 동시에 실행하고, 같은 세션의 turn은 순서대로 실행.
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
  "browserUseMode": "auto",
  "stateFile": "~/.local/state/telegram-codex-bridge/state.json",
  "recentSessionLimit": 10,
  "pollTimeoutSeconds": 25
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
- `BRIDGE_BROWSER_USE_MODE` (`auto`, `always`, `never`)
- `TELEGRAM_POLL_TIMEOUT`
- `BRIDGE_SESSION_LIMIT`

## 실행

```bash
npm start
```

같은 bot token으로 long polling consumer를 두 개 이상 동시에 실행하지 마세요. Telegram update가 한쪽으로만 전달될 수 있습니다.

bridge는 일반 `codex exec` backend로 Codex를 실행합니다. Codex app-server 프로세스를 시작하거나 probe하지 않습니다. macOS Codex 앱 번들이 `/Applications/Codex.app`에 설치되어 있으면, bridge는 앱에 포함된 `node_repl` runtime을 `codex exec`에 넘겨 Browser Use/Chrome 확장 자동화를 Codex skill에서 bootstrap할 수 있습니다. `browserUseMode`가 이 주입 시점을 제어합니다. `auto`는 브라우저가 필요해 보이는 prompt에만 주입하고, `always`는 기존 eager 동작을 유지하며, `never`는 비활성화합니다.

Codex prompt는 background job으로 예약되므로, 하나의 prompt가 실행 중이어도 bridge는 Telegram 명령을 계속 받을 수 있습니다. 서로 다른 Codex 세션의 job은 동시에 실행될 수 있습니다. 같은 세션을 대상으로 하는 여러 turn은 session state가 꼬이지 않도록 순서대로 queue에서 실행됩니다.

bridge 응답은 원본 Telegram 메시지의 reply로 전송됩니다. 여러 job이 동시에 실행될 때도 어떤 prompt에 대한 출력인지 구분하기 쉽습니다.

## Telegram 명령어

- `/new <내용>`: 새 지속 Codex 세션을 시작하고 이 채팅에 연결합니다.
- `/continue <내용>`: 현재 연결된 세션을 이어갑니다.
- `/once <내용>`: 저장되지 않는 1회성 Codex 작업을 실행합니다.
- `/sessions`: `session_index.jsonl`에서 최근 세션 목록을 보여줍니다.
- `/attach <세션ID 또는 제목>`: 기존 세션에 이 채팅을 연결합니다.
- `/forget`: 현재 세션 연결을 해제합니다.
- `/status`: bridge 상태와 queued/running job을 보여줍니다.
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

이 동작은 새 세션 생성 시 bridge 코드가 자동으로 수행합니다. bridge는 `codex://threads/<id>`를 열지 않으므로 현재 열려 있는 Codex 앱 탭을 바꾸지 않고 세션 리스트만 갱신할 수 있습니다.

## 보안 메모

- `telegram-bot-token`, 로컬 `config.json`, state 파일을 commit하지 마세요.
- `allowedUsers`는 본인 또는 신뢰하는 Telegram user ID로 제한하세요.
- `sandboxMode`, `approvalPolicy`는 Codex에 그대로 전달됩니다. 위험 허용 범위에 맞춰 선택하세요.
- 이 bridge는 Telegram prompt를 Codex에 전달합니다. allowlist에 들어간 Telegram 접근은 로컬 agent 접근과 비슷하게 취급해야 합니다.

## 테스트

```bash
npm test
```

## 라이선스

MIT

[맨 위로](#telegram-codex-bridge)
