import { spawn as defaultSpawn } from 'node:child_process';

export class CodexRunner {
  constructor({ spawn = defaultSpawn, codexHome, defaultCwd, codexCommand = 'codex', model, skipGitRepoCheck = false } = {}) {
    this.spawn = spawn;
    this.codexHome = codexHome;
    this.defaultCwd = defaultCwd;
    this.codexCommand = codexCommand;
    this.model = model;
    this.skipGitRepoCheck = skipGitRepoCheck;
  }

  runNew(prompt, options = {}) {
    const args = ['exec', '--json'];
    this.#addCommonArgs(args);
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-C', options.cwd ?? this.defaultCwd, '-');
    return this.#run(args, prompt);
  }

  resume(sessionId, prompt) {
    const args = ['exec', 'resume', sessionId, '--json'];
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-');
    return this.#run(args, prompt);
  }

  runOnce(prompt, options = {}) {
    const args = ['exec', '--json', '--ephemeral'];
    this.#addCommonArgs(args);
    if (this.model) {
      args.push('-m', this.model);
    }
    args.push('-C', options.cwd ?? this.defaultCwd, '-');
    return this.#run(args, prompt);
  }

  #addCommonArgs(args) {
    if (this.skipGitRepoCheck) {
      args.push('--skip-git-repo-check');
    }
  }

  #run(args, prompt) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let finalMessage = '';
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
        for (const line of text.split(/\r?\n/).filter(Boolean)) {
          const parsed = parseJsonLine(line);
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
        if (code === 0) {
          resolve({ finalMessage: finalMessage || stdout.trim(), stdout, stderr });
          return;
        }
        reject(new Error(`codex exited with ${code}: ${stderr || stdout}`));
      });

      child.stdin.end(`${prompt}\n`);
    });
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
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
