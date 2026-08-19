const RUNTIME_ERROR_CODES = Object.freeze({
  RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
  INVALID_ENDPOINT: 'INVALID_ENDPOINT',
  AUTH_FAILED: 'AUTH_FAILED',
  HOST_KEY_CHANGED: 'HOST_KEY_CHANGED',
  SHELL_NOT_DETECTED: 'SHELL_NOT_DETECTED',
  PYTHON3_NOT_FOUND: 'PYTHON3_NOT_FOUND',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  SESSION_CLOSED: 'SESSION_CLOSED',
  RUN_ALREADY_ACTIVE: 'RUN_ALREADY_ACTIVE',
  RUN_START_FAILED: 'RUN_START_FAILED',
  RUN_STOP_FAILED: 'RUN_STOP_FAILED',
  FILE_TRANSFER_FAILED: 'FILE_TRANSFER_FAILED',
  AUTOSTART_PERMISSION_DENIED: 'AUTOSTART_PERMISSION_DENIED',
  PREVIEW_UNAVAILABLE: 'PREVIEW_UNAVAILABLE',
  PROTOCOL_DESYNC: 'PROTOCOL_DESYNC',
});

const PUBLIC_MESSAGES = Object.freeze({
  [RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE]: 'The selected runtime is unavailable. Check the connection and try again.',
  [RUNTIME_ERROR_CODES.INVALID_ENDPOINT]: 'The connection settings are invalid. Check the endpoint values and try again.',
  [RUNTIME_ERROR_CODES.AUTH_FAILED]: 'Authentication failed. Check the selected credential and try again.',
  [RUNTIME_ERROR_CODES.HOST_KEY_CHANGED]: 'The remote host key changed. Verify the device identity before reconnecting.',
  [RUNTIME_ERROR_CODES.SHELL_NOT_DETECTED]: 'A Linux shell was not detected on this port. Check the board port and baud rate.',
  [RUNTIME_ERROR_CODES.PYTHON3_NOT_FOUND]: 'python3 was not found on the board.',
  [RUNTIME_ERROR_CODES.CAPABILITY_UNAVAILABLE]: 'This board does not support the requested capability.',
  [RUNTIME_ERROR_CODES.SESSION_CLOSED]: 'The runtime session is closed. Connect again.',
  [RUNTIME_ERROR_CODES.RUN_ALREADY_ACTIVE]: 'A script is already running on this board.',
  [RUNTIME_ERROR_CODES.RUN_START_FAILED]: 'The script could not be started on the board.',
  [RUNTIME_ERROR_CODES.RUN_STOP_FAILED]: 'The running script could not be stopped safely.',
  [RUNTIME_ERROR_CODES.FILE_TRANSFER_FAILED]: 'The file operation failed on the board.',
  [RUNTIME_ERROR_CODES.AUTOSTART_PERMISSION_DENIED]: 'The board denied the autostart operation. Check the required permissions.',
  [RUNTIME_ERROR_CODES.PREVIEW_UNAVAILABLE]: 'Camera preview is unavailable on this board.',
  [RUNTIME_ERROR_CODES.PROTOCOL_DESYNC]: 'The board communication protocol lost synchronization. Reconnect and try again.',
});

class RuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    if (options.cause) this.cause = options.cause;
    if (options.details) this.details = options.details;
  }
}

function runtimeError(code, message, options) {
  return new RuntimeError(code, message, options);
}

function toPublicRuntimeError(error, fallbackCode = RUNTIME_ERROR_CODES.RUNTIME_UNAVAILABLE) {
  const code = error instanceof RuntimeError && PUBLIC_MESSAGES[error.code]
    ? error.code
    : fallbackCode;
  const details = error instanceof RuntimeError ? sanitizeDetails(error.details) : undefined;
  return new RuntimeError(code, PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.RUNTIME_UNAVAILABLE, details ? { details } : {});
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowed = ['phase', 'suggestion', 'operation', 'adapterId', 'retryable'];
  const result = {};
  for (const key of allowed) {
    const value = details[key];
    if (typeof value === 'string' && value.length <= 160 && !/[\0\r\n]/.test(value)) result[key] = value;
    if (key === 'retryable' && typeof value === 'boolean') result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

module.exports = {
  RUNTIME_ERROR_CODES,
  RuntimeError,
  runtimeError,
  toPublicRuntimeError,
};
