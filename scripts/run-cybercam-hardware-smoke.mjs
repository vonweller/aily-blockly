import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { CanmvBackend } = require('../electron/python-runtime/backend.js');
const {
  resolveCanmvBackendExecutable,
} = require('../electron/python-runtime/runtime-path.js');

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const PYTHON_RUNTIME_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'electron',
  'python-runtime',
);
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BAUD_RATE = 115200;
const TERMINAL_SCRIPT_STATES = new Set(['finished', 'stopped']);

export async function runCybercamHardwareSmoke(options = {}) {
  const backend = options.backend;
  if (!backend || typeof backend.request !== 'function') {
    throw new TypeError('backend with a request(method, params) function is required');
  }

  const marker = validateMarker(options.marker || createMarker());
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  let connected = false;
  let stopAttempted = false;
  let disconnectAttempted = false;
  let result;
  let primaryError;
  let evidenceWaiter;

  try {
    const detected = await backend.request('detectBoards', {});
    const boards = normalizeBoards(detected);
    const board = selectBoard(boards, options.port);

    const connection = await backend.request('connectBoard', {
      port: board.port,
      baudRate: DEFAULT_BAUD_RATE,
    });
    connected = true;

    evidenceWaiter = waitForScriptEvidence(backend, marker, timeoutMs);
    evidenceWaiter.promise.catch(() => undefined);
    await backend.request('runScript', {
      script: `print("${marker}")\n`,
    });
    const evidence = await evidenceWaiter.promise;

    const scriptRunning = await backend.request('scriptRunning', {});
    if (scriptRunning?.running !== false) {
      throw new Error('CyberCAM script is still running after terminal completion');
    }
    const rootDirectory = await backend.request('io.listDir', { path: '/' });
    const firmware = await backend.request('getFirmwareCommit', {});

    stopAttempted = true;
    await backend.request('stopScript', {});
    disconnectAttempted = true;
    await backend.request('disconnectBoard', {});
    connected = false;

    result = {
      status: 'passed',
      board,
      connection,
      marker,
      output: evidence.output,
      scriptStates: evidence.states,
      scriptRunning,
      rootDirectory,
      firmware,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    evidenceWaiter?.cancel();
  }

  const cleanupErrors = [];
  if (connected && !stopAttempted) {
    try {
      stopAttempted = true;
      await backend.request('stopScript', {});
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (connected && !disconnectAttempted) {
    try {
      disconnectAttempted = true;
      await backend.request('disconnectBoard', {});
      connected = false;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (typeof backend.stop === 'function') {
    try {
      await backend.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError) {
    if (cleanupErrors.length > 0) primaryError.cleanupErrors = cleanupErrors;
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'CyberCAM smoke test cleanup failed',
    );
  }
  return result;
}

export function parseArguments(argv) {
  const result = { port: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }
    if (argument === '--port') {
      const port = argv[index + 1];
      if (!port || port.startsWith('-')) {
        throw new Error('--port requires a value');
      }
      result.port = port;
      index += 1;
      continue;
    }
    if (argument.startsWith('--port=')) {
      const port = argument.slice('--port='.length);
      if (!port) throw new Error('--port requires a value');
      result.port = port;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function createBackend() {
  const executable = resolveCanmvBackendExecutable({
    override: process.env.AILY_CANMV_BACKEND,
    isPackaged: false,
    moduleDir: PYTHON_RUNTIME_DIRECTORY,
    platform: process.platform,
    arch: process.arch,
  });
  if (!existsSync(executable)) {
    throw new Error(`CanMV backend executable was not found: ${executable}`);
  }
  return new CanmvBackend({
    executable,
    cwd: path.dirname(executable),
    requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

function normalizeBoards(detected) {
  const boards = Array.isArray(detected) ? detected : detected?.boards;
  if (!Array.isArray(boards)) {
    throw new Error('CanMV backend returned an invalid board list');
  }
  return boards.filter((board) => (
    board
    && typeof board === 'object'
    && typeof board.port === 'string'
    && board.port.trim().length > 0
  ));
}

function selectBoard(boards, requestedPort) {
  if (requestedPort) {
    const normalizedPort = requestedPort.trim().toLowerCase();
    const board = boards.find(
      (candidate) => candidate.port.trim().toLowerCase() === normalizedPort,
    );
    if (!board) {
      throw new Error(
        `Requested port ${requestedPort} was not found; detected ports: ${
          boards.map((candidate) => candidate.port).join(', ') || 'none'
        }`,
      );
    }
    return board;
  }

  const board = boards.find(isCybercamBoard);
  if (!board) {
    throw new Error(
      `No CyberCAM was detected; detected boards: ${
        boards.map((candidate) => (
          `${candidate.name || 'unnamed'} (${candidate.port})`
        )).join(', ') || 'none'
      }`,
    );
  }
  return board;
}

function isCybercamBoard(board) {
  const identity = [
    board.name,
    board.boardType,
    board.description,
    board.product,
  ].filter(Boolean).join(' ').toLowerCase();
  if (identity.includes('cybercam')) return true;
  return String(board.vid || '').toLowerCase() === '1209'
    && String(board.pid || '').toLowerCase() === 'abd1';
}

function waitForScriptEvidence(backend, marker, timeoutMs) {
  let settled = false;
  let output = '';
  const states = [];
  let resolvePromise;
  let rejectPromise;

  const cleanup = () => {
    clearTimeout(timer);
    backend.removeListener('event', onEvent);
  };
  const settle = (callback, value) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback(value);
  };
  const onEvent = (message) => {
    if (message?.event === 'scriptOutput') {
      output += String(message.params?.text || '');
    } else if (message?.event === 'scriptState') {
      const state = String(message.params?.state || '');
      if (state) states.push(state);
      if (state === 'error') {
        settle(
          rejectPromise,
          new Error('CyberCAM reported an error script state'),
        );
        return;
      }
    }

    if (
      output.includes(marker)
      && states.some((state) => TERMINAL_SCRIPT_STATES.has(state))
    ) {
      settle(resolvePromise, { output, states: [...states] });
    }
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = setTimeout(() => {
    settle(
      rejectPromise,
      new Error(
        `Timed out waiting for CyberCAM script output/state after ${timeoutMs} ms`,
      ),
    );
  }, timeoutMs);
  backend.on('event', onEvent);

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

function createMarker() {
  return `AILY_CYBERCAM_SMOKE_${randomUUID().replaceAll('-', '').toUpperCase()}`;
}

function validateMarker(marker) {
  if (!/^[A-Z0-9_]+$/.test(marker)) {
    throw new TypeError('marker must contain only uppercase letters, digits, and underscores');
  }
  return marker;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node scripts/run-cybercam-hardware-smoke.mjs [--port COM9]

Safely detects and connects to a CyberCAM, runs a Python script that only
prints a unique marker, verifies output/state/status/root listing/firmware,
then stops, disconnects, and closes the local CanMV backend.`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const result = await runCybercamHardwareSmoke({
    backend: createBackend(),
    port: args.port,
  });
  console.log(JSON.stringify(result, null, 2));
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const invokedPath = path.resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  return process.platform === 'win32'
    ? invokedPath.toLowerCase() === modulePath.toLowerCase()
    : invokedPath === modulePath;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error?.stack || error);
    if (Array.isArray(error?.cleanupErrors)) {
      for (const cleanupError of error.cleanupErrors) {
        console.error('Cleanup error:', cleanupError?.stack || cleanupError);
      }
    }
    process.exitCode = 1;
  });
}
