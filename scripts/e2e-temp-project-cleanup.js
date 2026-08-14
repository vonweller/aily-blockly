const TRANSIENT_REMOVE_ERRORS = new Set(['ENOTEMPTY', 'EPERM', 'EACCES']);

async function cleanupTemporaryProject(options) {
  const {
    target,
    primaryError,
    leaveProject,
    removeDirectory,
    attempts = 5,
    delay = defaultDelay,
    warn = message => console.warn(message),
  } = options;
  const cleanupErrors = [];

  try {
    await leaveProject();
  } catch (error) {
    cleanupErrors.push(error);
  }

  try {
    await removeWithRetry(target, removeDirectory, delay, attempts);
  } catch (error) {
    cleanupErrors.push(error);
  }

  if (cleanupErrors.length === 0) return;
  const cleanupError = cleanupErrors.length === 1
    ? cleanupErrors[0]
    : new AggregateError(cleanupErrors, `Cleanup failed for ${target}`);
  if (primaryError) {
    warn(`Cleanup failed for ${target}: ${errorText(cleanupError)}`);
    return;
  }
  throw cleanupError;
}

async function removeWithRetry(target, removeDirectory, delay, attempts) {
  const boundedAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    try {
      await removeDirectory(target);
      return;
    } catch (error) {
      if (
        attempt >= boundedAttempts
        || !TRANSIENT_REMOVE_ERRORS.has(error?.code)
      ) {
        throw error;
      }
      await delay(attempt);
    }
  }
}

function defaultDelay(attempt) {
  return new Promise(resolve => setTimeout(resolve, Math.min(100 * attempt, 500)));
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = {
  cleanupTemporaryProject,
};
