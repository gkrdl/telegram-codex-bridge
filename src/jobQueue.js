export class SessionJobQueue {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.nextId = 1;
    this.sessionTails = new Map();
    this.jobs = new Map();
  }

  enqueue({ sessionKey = '', label = 'Codex job', run }) {
    if (typeof run !== 'function') {
      throw new TypeError('run must be a function');
    }

    const id = String(this.nextId++);
    const job = {
      id,
      label,
      sessionKey,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: '',
      finishedAt: '',
      error: '',
    };
    this.jobs.set(id, job);

    const previous = sessionKey
      ? this.sessionTails.get(sessionKey) ?? Promise.resolve()
      : Promise.resolve();

    const promise = previous.catch(() => {}).then(async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      try {
        const result = await run({ id, job });
        job.status = 'completed';
        return result;
      } catch (error) {
        job.status = 'failed';
        job.error = error?.message || String(error);
        throw error;
      } finally {
        job.finishedAt = new Date().toISOString();
        if (sessionKey && this.sessionTails.get(sessionKey) === tail) {
          this.sessionTails.delete(sessionKey);
        }
      }
    });

    const tail = promise.catch((error) => {
      this.logger.error?.(`[job ${id}] ${error.stack || error.message}`);
    });
    if (sessionKey) {
      this.sessionTails.set(sessionKey, tail);
    }

    return { id, promise };
  }

  snapshot() {
    return [...this.jobs.values()].map((job) => ({ ...job }));
  }
}
