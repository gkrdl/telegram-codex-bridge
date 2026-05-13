import { spawn as defaultSpawn } from 'node:child_process';

export class CodexRunner {
  constructor({
    spawn = defaultSpawn,
    codexHome,
    defaultCwd,
    codexCommand = 'codex',
    model,
    skipGitRepoCheck = false,
    sandboxMode,
    approvalPolicy,
    browserUseRuntime,
    trustedBrowserClientSha256s = ['9990b9b3defcd92659e0d88c4cf847d97c64c0af047c4a24266821711c24749e'],
  } = {}) {
    this.name = 'exec';
    this.spawn = spawn;
    this.codexHome = codexHome;
    this.defaultCwd = defaultCwd;
    this.codexCommand = codexCommand;
    this.model = model;
    this.skipGitRepoCheck = skipGitRepoCheck;
    this.sandboxMode = sandboxMode;
    this.approvalPolicy = approvalPolicy;
    this.browserUseRuntime = browserUseRuntime;
    this.trustedBrowserClientSha256s = trustedBrowserClientSha256s;
  }

  runNew(prompt, options = {}) {
    const args = ['exec', '--json'];
    this.#addCommonArgs(args);
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-C', options.cwd ?? this.defaultCwd, '-');
    return this.#run(args, prompt, options);
  }

  resume(sessionId, prompt, options = {}) {
    const args = ['exec', 'resume', sessionId, '--json'];
    this.#addCommonArgs(args);
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-');
    return this.#run(args, prompt, options);
  }

  runOnce(prompt, options = {}) {
    const args = ['exec', '--json', '--ephemeral'];
    this.#addCommonArgs(args);
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-C', options.cwd ?? this.defaultCwd, '-');
    return this.#run(args, prompt, options);
  }

  #addCommonArgs(args) {
    if (this.skipGitRepoCheck) {
      args.push('--skip-git-repo-check');
    }
    if (this.sandboxMode) {
      args.push('-c', `sandbox_mode="${this.sandboxMode}"`);
    }
    if (this.approvalPolicy) {
      args.push('-c', `approval_policy="${this.approvalPolicy}"`);
    }
    for (const [key, value] of this.#browserUseConfigOverrides()) {
      args.push('-c', `${key}=${value}`);
    }
  }

  #browserUseConfigOverrides() {
    const runtime = this.browserUseRuntime;
    if (!runtime?.nodeReplPath || !runtime?.nodePath) {
      return [];
    }
    const backends = Array.isArray(runtime.backends) ? runtime.backends : ['chrome'];
    const requestMeta = JSON.stringify({ 'x-codex-browser-use-available-backends': backends });
    return [
      ['features.js_repl', 'false'],
      ['mcp_servers.node_repl.command', tomlString(runtime.nodeReplPath)],
      ['mcp_servers.node_repl.args', '[]'],
      ['mcp_servers.node_repl.startup_timeout_sec', '120'],
      ['mcp_servers.node_repl.env.NODE_REPL_NATIVE_PIPE_CONNECT_TIMEOUT_MS', tomlString('1000')],
      ['mcp_servers.node_repl.env.NODE_REPL_NODE_MODULE_DIRS', tomlString('')],
      ['mcp_servers.node_repl.env.NODE_REPL_NODE_PATH', tomlString(runtime.nodePath)],
      ['mcp_servers.node_repl.env.CODEX_HOME', tomlString(this.codexHome || '')],
      ['mcp_servers.node_repl.env.NODE_REPL_REQUEST_META', tomlString(requestMeta)],
      ['mcp_servers.node_repl.env.NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S', tomlString(this.trustedBrowserClientSha256s.join(','))],
      ['mcp_servers.node_repl.env.NODE_REPL_BROWSER_CLIENT_MARKETPLACE_NAME', tomlString('openai-bundled')],
      ...(runtime.codexCliPath ? [['mcp_servers.node_repl.env.CODEX_CLI_PATH', tomlString(runtime.codexCliPath)]] : []),
    ];
  }

  #run(args, prompt, options = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finalMessage = '';
      let sessionId = '';
      let pendingLine = '';
      const child = this.spawn(this.codexCommand, args, {
        env: {
          ...process.env,
          ...(this.codexHome ? { CODEX_HOME: this.codexHome } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        stdout += text;
        const lines = `${pendingLine}${text}`.split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
          const parsed = parseJsonLine(line);
          if (parsed && options.onProgress) {
            options.onProgress(parsed);
          }
          const parsedSessionId = extractSessionId(parsed);
          if (parsedSessionId) {
            sessionId = parsedSessionId;
          }
          const message = extractAssistantText(parsed);
          if (message) {
            finalMessage = message;
          }
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (pendingLine) {
          const parsed = parseJsonLine(pendingLine);
          if (parsed && options.onProgress) {
            options.onProgress(parsed);
          }
          const parsedSessionId = extractSessionId(parsed);
          if (parsedSessionId) {
            sessionId = parsedSessionId;
          }
          const message = extractAssistantText(parsed);
          if (message) {
            finalMessage = message;
          }
        }
        if (code === 0) {
          resolve({ finalMessage: finalMessage || stdout.trim(), stdout, stderr, sessionId });
          return;
        }
        reject(new Error(`codex exited with ${code}: ${stderr || stdout}`));
      });

      child.stdin.end(`${prompt}\n`);
    });
  }
}

function extractSessionId(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  if (event.type === 'thread.started') {
    return event.thread_id || event.threadId || '';
  }
  if (event.type === 'session_meta') {
    return event.payload?.id || event.id || '';
  }
  return '';
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function extractAssistantText(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  if (event.type === 'message' && event.role === 'assistant') {
    return contentToText(event.content);
  }
  if (event.type === 'agent_message' || event.type === 'final_message') {
    return contentToText(event.message ?? event.content ?? event.text);
  }
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    return contentToText(event.item.text ?? event.item.content);
  }
  return '';
}

function contentToText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        return item?.text ?? item?.content ?? '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}
