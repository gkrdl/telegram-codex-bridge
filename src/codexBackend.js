export async function createCodexBackend({ appServerRunner, execRunner, logger = console } = {}) {
  logger.log?.('[bridge] using Codex exec backend');
  return execRunner;
}
