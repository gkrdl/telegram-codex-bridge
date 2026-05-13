import { spawn as defaultSpawn } from 'node:child_process';

export class AppServerRunner {
  constructor({
    spawn = defaultSpawn,
    codexCommand = 'codex',
    codexHome,
    defaultCwd,
    model,
    sandboxMode,
    approvalPolicy,
    probeTimeoutMs = 1500,
  } = {}) {
    this.name = 'app-server';
    this.spawn = spawn;
    this.codexCommand = codexCommand;
    this.codexHome = codexHome;
    this.defaultCwd = defaultCwd;
    this.model = model;
    this.sandboxMode = sandboxMode;
    this.approvalPolicy = approvalPolicy;
    this.probeTimeoutMs = probeTimeoutMs;
  }

  async probe() {
    try {
      const client = this.#createClient();
      await client.initialize(this.probeTimeoutMs);
      await client.request('thread/loaded/list', { limit: 1 }, this.probeTimeoutMs);
      client.close();
      return true;
    } catch {
      return false;
    }
  }

  async runNew(prompt, options = {}) {
    return this.#runThread(prompt, {
      ...options,
      start: async (client) => {
        const response = await client.request('thread/start', this.#threadParams({ ephemeral: false }));
        return response?.thread?.id || response?.threadId || '';
      },
    });
  }

  async resume(sessionId, prompt, options = {}) {
    return this.#runThread(prompt, {
      ...options,
      start: async (client) => {
        const response = await client.request('thread/resume', {
          threadId: sessionId,
          ...this.#threadParams({ includeCwd: false }),
        });
        return response?.thread?.id || sessionId;
      },
    });
  }

  async runOnce(prompt, options = {}) {
    return this.#runThread(prompt, {
      ...options,
      start: async (client) => {
        const response = await client.request('thread/start', this.#threadParams({ ephemeral: true }));
        return response?.thread?.id || response?.threadId || '';
      },
    });
  }

  async #runThread(prompt, { start, onProgress } = {}) {
    const client = this.#createClient();
    let sessionId = '';
    let finalMessage = '';
    let completed = false;

    try {
      client.onNotification((message) => {
        const event = notificationToProgressEvent(message);
        if (!event) {
          return;
        }
        if (event.thread_id) {
          sessionId = event.thread_id;
        }
        if (event.type === 'agent_message.delta') {
          finalMessage += event.delta || '';
        }
        const completedText = extractCompletedText(event);
        if (completedText) {
          finalMessage = completedText;
        }
        if (event.type === 'turn.completed') {
          completed = true;
        }
        if (onProgress) {
          onProgress(event);
        }
      });

      await client.initialize();
      sessionId = await start(client);
      if (sessionId && onProgress) {
        onProgress({ type: 'thread.started', thread_id: sessionId });
      }
      await client.request('turn/start', {
        threadId: sessionId,
        input: [{ type: 'text', text: String(prompt ?? ''), text_elements: [] }],
      });
      await client.waitFor(() => completed);
      return { finalMessage, stdout: '', stderr: '', sessionId };
    } finally {
      client.close();
    }
  }

  #threadParams({ ephemeral = undefined, includeCwd = true } = {}) {
    const params = {};
    if (this.model) {
      params.model = this.model;
    }
    if (includeCwd && this.defaultCwd) {
      params.cwd = this.defaultCwd;
    }
    if (this.approvalPolicy) {
      params.approvalPolicy = this.approvalPolicy;
    }
    if (this.sandboxMode) {
      params.sandbox = this.sandboxMode;
    }
    if (ephemeral !== undefined) {
      params.ephemeral = ephemeral;
    }
    return params;
  }

  #createClient() {
    return new AppServerJsonRpcClient({
      spawn: this.spawn,
      codexCommand: this.codexCommand,
      codexHome: this.codexHome,
    });
  }
}

class AppServerJsonRpcClient {
  constructor({ spawn, codexCommand, codexHome }) {
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = [];
    this.pendingLine = '';
    this.closed = false;
    this.child = spawn(codexCommand, ['app-server', 'proxy'], {
      env: {
        ...process.env,
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.#handleStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr || ''}${chunk.toString('utf8')}`;
    });
    this.child.on('error', (error) => this.#rejectAll(error));
    this.child.on('close', (code) => {
      this.closed = true;
      if (code !== 0) {
        this.#rejectAll(new Error(`app-server proxy exited with ${code}: ${this.stderr || ''}`));
      }
    });
  }

  initialize(timeoutMs) {
    return this.request('initialize', {
      clientInfo: { name: 'telegram-codex-bridge', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    }, timeoutMs);
  }

  request(method, params = {}, timeoutMs = 300000) {
    if (this.closed) {
      return Promise.reject(new Error('app-server proxy is closed'));
    }
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  onNotification(handler) {
    this.notificationHandlers.push(handler);
  }

  waitFor(predicate, timeoutMs = 300000) {
    if (predicate()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timed out waiting for app-server notification'));
      }, timeoutMs);
      const handler = () => {
        if (!predicate()) {
          return;
        }
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.notificationHandlers = this.notificationHandlers.filter((item) => item !== handler);
      };
      this.onNotification(handler);
    });
  }

  close() {
    this.child.stdin.end();
    this.child.kill?.();
  }

  #handleStdout(chunk) {
    const lines = `${this.pendingLine}${chunk.toString('utf8')}`.split(/\r?\n/);
    this.pendingLine = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      this.#handleMessage(line);
    }
  }

  #handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id && this.pending.has(String(message.id))) {
      const pending = this.pending.get(String(message.id));
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      for (const handler of this.notificationHandlers) {
        handler(message);
      }
    }
  }

  #rejectAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function notificationToProgressEvent(message) {
  const params = message.params || {};
  if (message.method === 'thread/started') {
    return { type: 'thread.started', thread_id: params.thread?.id || params.threadId || params.id || '' };
  }
  if (message.method === 'turn/started') {
    return { type: 'turn.started', thread_id: params.threadId };
  }
  if (message.method === 'turn/completed') {
    return { type: 'turn.completed', thread_id: params.threadId };
  }
  if (message.method === 'item/agentMessage/delta') {
    return { type: 'agent_message.delta', thread_id: params.threadId, delta: params.delta || '' };
  }
  if (message.method === 'item/completed') {
    return { type: 'item.completed', thread_id: params.threadId, item: normalizeItem(params.item) };
  }
  return null;
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') {
    return item;
  }
  if (item.type === 'agentMessage') {
    return { ...item, type: 'agent_message' };
  }
  return item;
}

function extractCompletedText(event) {
  if (event.type !== 'item.completed') {
    return '';
  }
  if (event.item?.type === 'agent_message') {
    return event.item.text || '';
  }
  return '';
}
