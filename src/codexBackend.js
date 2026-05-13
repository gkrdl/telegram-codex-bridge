export async function createCodexBackend({ appServerRunner, execRunner, logger = console } = {}) {
  try {
    if (appServerRunner && await appServerRunner.probe()) {
      logger.log?.('[bridge] using Codex app-server backend');
      return appServerRunner;
    }
  } catch (error) {
    logger.error?.(`[bridge] app-server probe failed: ${error.stack || error.message}`);
  }
  logger.log?.('[bridge] using Codex exec backend');
  return execRunner;
}
