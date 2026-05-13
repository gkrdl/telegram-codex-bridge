# Telegram Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a lightweight Telegram bot that dispatches messages to Codex CLI with explicit session controls.

**Architecture:** A small Node ESM service long-polls Telegram, routes commands, persists active sessions per chat, and invokes Codex CLI. The routing layer is isolated from Telegram and Codex process execution so it can be tested without network or model calls.

**Tech Stack:** Node 20+, built-in `node:test`, built-in `fetch`, Codex CLI.

---

### Task 1: Project And Routing Core

**Files:**
- Create: `package.json`
- Create: `src/router.js`
- Create: `test/router.test.js`

- [x] Write failing tests for command and default routing.
- [x] Run the router tests and verify missing modules fail.
- [x] Implement minimal routing code.
- [x] Run router tests and verify they pass.

### Task 2: Session Store And Codex Session Index

**Files:**
- Create: `src/sessionStore.js`
- Create: `src/codexSessions.js`
- Create: `test/sessionStore.test.js`
- Create: `test/codexSessions.test.js`

- [x] Write failing tests for JSON state persistence and JSONL index parsing.
- [x] Run tests and verify missing modules fail.
- [x] Implement store and index parser.
- [x] Run tests and verify they pass.

### Task 3: Codex Runner

**Files:**
- Create: `src/codexRunner.js`
- Create: `test/codexRunner.test.js`

- [x] Write failing tests for new, resume, and once command construction.
- [x] Run tests and verify missing module failure.
- [x] Implement process spawning and JSONL final-message parsing.
- [x] Run tests and verify they pass.

### Task 4: Telegram Runtime

**Files:**
- Create: `src/config.js`
- Create: `src/telegram.js`
- Create: `src/index.js`
- Create: `README.md`

- [x] Implement config loading and Telegram polling.
- [x] Wire route decisions to Codex runner and replies.
- [x] Document setup, commands, and launch instructions.
- [x] Run the full test suite.
