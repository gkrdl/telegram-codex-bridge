import { spawn as defaultSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync as defaultExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

export class AppServerRunner {
  constructor({
    spawn = defaultSpawn,
    existsSync = defaultExistsSync,
    connectAppServer = defaultConnectAppServer,
    codexCommand = 'codex',
    codexHome,
    defaultCwd,
    model,
    sandboxMode,
    approvalPolicy,
    platform = process.platform,
    probeTimeoutMs = 1500,
    startTimeoutMs = 5000,
    socketPath,
  } = {}) {
    this.name = 'app-server';
    this.spawn = spawn;
    this.existsSync = existsSync;
    this.connectAppServer = connectAppServer;
    this.codexCommand = codexCommand;
    this.codexHome = codexHome || join(homedir(), '.codex');
    this.defaultCwd = defaultCwd;
    this.model = model;
    this.sandboxMode = sandboxMode;
    this.approvalPolicy = approvalPolicy;
    this.platform = platform;
    this.probeTimeoutMs = probeTimeoutMs;
    this.startTimeoutMs = startTimeoutMs;
    this.socketPath = socketPath || join(this.codexHome, 'app-server-control', 'app-server-control.sock');
    this.serverChild = null;
    this.endpoint = null;
  }

  async probe() {
    try {
      const client = await this.#createClient();
      await client.initialize(this.probeTimeoutMs);
      await client.request('thread/loaded/list', { limit: 1 }, this.probeTimeoutMs);
      client.close();
      return true;
    } catch {
      this.dispose();
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

  dispose() {
    this.serverChild?.kill?.();
    this.serverChild = null;
    this.endpoint = null;
  }

  async #runThread(prompt, { start, onProgress } = {}) {
    const client = await this.#createClient();
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
    return AppServerJsonRpcClient.create({
      connectAppServer: this.connectAppServer,
      endpoint: this.#ensureEndpoint(),
    });
  }

  async #ensureEndpoint() {
    if (this.endpoint) {
      return this.endpoint;
    }
    if (this.platform === 'win32') {
      this.endpoint = await this.#startWebSocketServer();
      return this.endpoint;
    }
    const endpoint = {
      kind: 'unix',
      socketPath: this.socketPath,
      url: 'ws://codex-app-server/rpc',
    };
    if (!this.existsSync(this.socketPath)) {
      await this.#startUnixServer();
    }
    this.endpoint = endpoint;
    return endpoint;
  }

  #startUnixServer() {
    this.#spawnServer(['app-server', '--listen', 'unix://']);
    return waitFor({
      test: () => this.existsSync(this.socketPath),
      timeoutMs: this.startTimeoutMs,
      timeoutMessage: `Timed out waiting for app-server socket: ${this.socketPath}`,
    });
  }

  #startWebSocketServer() {
    const child = this.#spawnServer(['app-server', '--listen', 'ws://127.0.0.1:0']);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for app-server websocket listener'));
      }, this.startTimeoutMs);
      const onData = (chunk) => {
        const text = chunk.toString('utf8');
        const match = text.match(/listening on:\s*(ws:\/\/127\.0\.0\.1:\d+)/);
        if (!match) {
          return;
        }
        cleanup();
        resolve({ kind: 'websocket', url: `${match[1]}/rpc` });
      };
      const onExit = (code) => {
        cleanup();
        reject(new Error(`app-server exited before websocket listener was ready: ${code}`));
      };
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout?.off?.('data', onData);
        child.stderr?.off?.('data', onData);
        child.off?.('close', onExit);
        child.off?.('error', reject);
      };
      child.stdout?.on?.('data', onData);
      child.stderr?.on?.('data', onData);
      child.once?.('close', onExit);
      child.once?.('error', reject);
    });
  }

  #spawnServer(args) {
    if (this.serverChild) {
      return this.serverChild;
    }
    const child = this.spawn(this.codexCommand, args, {
      env: {
        ...process.env,
        ...(this.codexHome ? { CODEX_HOME: this.codexHome } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once?.('close', () => {
      this.serverChild = null;
      this.endpoint = null;
    });
    this.serverChild = child;
    return child;
  }
}

class AppServerJsonRpcClient {
  static async create({ connectAppServer, endpoint }) {
    return new AppServerJsonRpcClient(await connectAppServer(await endpoint));
  }

  constructor(connection) {
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandlers = [];
    this.closed = false;
    this.connection = connection;
    this.connection.on('message', (message) => this.#handleMessage(message));
    this.connection.on('error', (error) => this.#rejectAll(error));
    this.connection.on('close', () => {
      this.closed = true;
      this.#rejectAll(new Error('app-server websocket closed'));
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
      return Promise.reject(new Error('app-server websocket is closed'));
    }
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app-server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.connection.send(payload);
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
    this.connection.close();
  }

  #handleMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(String(rawMessage));
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

async function waitFor({ test, timeoutMs, intervalMs = 25, timeoutMessage }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (test()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(timeoutMessage);
}

function defaultConnectAppServer(endpoint) {
  const url = new URL(endpoint.url);
  const socket = endpoint.kind === 'unix'
    ? net.createConnection(endpoint.socketPath)
    : net.createConnection(Number(url.port), url.hostname);
  return websocketConnection({ socket, host: url.host || 'codex-app-server', path: url.pathname || '/rpc' });
}

function websocketConnection({ socket, host, path }) {
  const connection = new EventEmitter();
  const key = crypto.randomBytes(16).toString('base64');
  let buffer = Buffer.alloc(0);
  let handshook = false;
  let settled = false;

  const ready = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
        return;
      }
      connection.emit('error', error);
    };
    socket.on('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshook) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        buffer = buffer.subarray(headerEnd + 4);
        if (!header.startsWith('HTTP/1.1 101')) {
          fail(new Error(`app-server websocket handshake failed: ${header.split('\r\n')[0] || header}`));
          return;
        }
        handshook = true;
        settled = true;
        resolve(connection);
      }
      parseFrames({ bufferRef: () => buffer, setBuffer: (next) => { buffer = next; }, socket, connection });
    });
    socket.on('error', fail);
    socket.on('close', () => {
      if (!settled) {
        settled = true;
        reject(new Error('app-server websocket closed before handshake completed'));
        return;
      }
      connection.emit('close');
    });
  });

  connection.send = (message) => {
    socket.write(encodeFrame({ opcode: 0x1, payload: Buffer.from(String(message), 'utf8') }));
  };
  connection.close = () => {
    try {
      socket.write(encodeFrame({ opcode: 0x8, payload: Buffer.alloc(0) }));
    } catch {
      // Ignore close races.
    }
    socket.end();
  };
  return ready;
}

function parseFrames({ bufferRef, setBuffer, socket, connection }) {
  let buffer = bufferRef();
  while (buffer.length >= 2) {
    const first = buffer[0];
    const second = buffer[1];
    const opcode = first & 0x0f;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) {
        break;
      }
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) {
        break;
      }
      const bigLength = buffer.readBigUInt64BE(2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        connection.emit('error', new Error('app-server websocket frame is too large'));
        return;
      }
      length = Number(bigLength);
      offset = 10;
    }
    const masked = (second & 0x80) !== 0;
    let mask;
    if (masked) {
      if (buffer.length < offset + 4) {
        break;
      }
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.length < offset + length) {
      break;
    }
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (masked) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    buffer = buffer.subarray(offset + length);
    if (opcode === 0x1) {
      connection.emit('message', payload.toString('utf8'));
    } else if (opcode === 0x8) {
      connection.emit('close');
    } else if (opcode === 0x9) {
      socket.write(encodeFrame({ opcode: 0xA, payload }));
    }
  }
  setBuffer(buffer);
}

function encodeFrame({ opcode, payload }) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | length]);
  } else if (length <= 0xffff) {
    header = Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff]);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  const mask = crypto.randomBytes(4);
  const frame = Buffer.alloc(header.length + mask.length + length);
  header.copy(frame, 0);
  mask.copy(frame, header.length);
  for (let index = 0; index < length; index += 1) {
    frame[header.length + mask.length + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
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
