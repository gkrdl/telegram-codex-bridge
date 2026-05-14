import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class SessionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeTail = Promise.resolve();
    this.nextWriteId = 1;
  }

  async getChatState(chatId) {
    const state = await this.#readState();
    return state.chats?.[String(chatId)] ?? {};
  }

  async setActiveSession(chatId, session) {
    await this.#updateState((state) => {
      state.chats ??= {};
      state.chats[String(chatId)] = {
        activeSessionId: session.sessionId,
        activeCwd: session.cwd,
        activeTitle: session.title,
      };
    });
  }

  async forgetChat(chatId) {
    await this.#updateState((state) => {
      if (state.chats) {
        delete state.chats[String(chatId)];
      }
    });
  }

  async #updateState(update) {
    const task = this.writeTail.catch(() => {}).then(async () => {
      const state = await this.#readState();
      update(state);
      await this.#writeState(state);
    });
    this.writeTail = task;
    await task;
  }

  async #readState() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : { chats: {} };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { chats: {} };
      }
      throw error;
    }
  }

  async #writeState(state) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${this.nextWriteId++}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.filePath);
  }
}
