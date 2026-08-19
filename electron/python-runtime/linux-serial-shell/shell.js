'use strict';

const { randomBytes } = require('node:crypto');
const {
  RUNTIME_ERROR_CODES,
  runtimeError,
} = require('../runtime-errors');

const DEFAULT_NONCE_PREFIX = 'LSS_NONCE_';
const SERIAL_A_GUIDANCE = 'Connect the WalnutPi SERIAL-A port at the expected baud rate, then try again.';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildShellNonceCommand(nonce) {
  if (!nonce || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    throw new Error('nonce must contain only shell-safe characters');
  }
  return `printf '\\n%s\\n' ${shellQuote(nonce)}`;
}

function outputLines(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function detectShellNonce(output, nonce) {
  return outputLines(output).some(line => line.trim() === nonce);
}

function detectShellPrompt(output) {
  const lines = outputLines(output);
  const text = lines.join('\n');
  if (/(?:^|\n)[^\n]*\blogin:\s*$/im.test(text)
    || /(?:^|\n)\s*password:\s*$/im.test(text)) {
    return 'login';
  }
  const lastLine = lines.at(-1) || '';
  if (/(?:^|\s)[^\n]*[@:/~A-Za-z0-9_.-][#$>]\s*$/.test(lastLine)
    || /^\s*[#$>]\s*$/.test(lastLine)) {
    return 'shell';
  }
  return null;
}

class ShellNonceDetector {
  constructor(nonce) {
    if (!nonce) throw new Error('nonce is required');
    this.nonce = nonce;
    this.seen = '';
    this.detected = false;
  }

  push(chunk) {
    if (this.detected) return true;
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    this.seen = `${this.seen}${text}`.slice(-(this.nonce.length + 1024));
    this.detected = detectShellNonce(this.seen, this.nonce);
    return this.detected;
  }
}

function createShellNonce(prefix = DEFAULT_NONCE_PREFIX) {
  if (!/^[A-Za-z0-9_-]*$/.test(prefix)) throw new Error('nonce prefix is not shell-safe');
  return `${prefix}${randomBytes(16).toString('hex')}`;
}

function createShellNotDetectedError(message = `A Linux shell was not detected. ${SERIAL_A_GUIDANCE}`) {
  return runtimeError(RUNTIME_ERROR_CODES.SHELL_NOT_DETECTED, message, {
    details: {
      phase: 'serial-shell-probe',
      suggestion: SERIAL_A_GUIDANCE,
      retryable: true,
    },
  });
}

module.exports = {
  DEFAULT_NONCE_PREFIX,
  SERIAL_A_GUIDANCE,
  ShellNonceDetector,
  buildShellNonceCommand,
  createShellNonce,
  createShellNotDetectedError,
  detectShellNonce,
  detectShellPrompt,
};
