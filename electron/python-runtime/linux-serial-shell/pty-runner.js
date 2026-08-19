'use strict';

const { shellQuote } = require('./bootstrap');

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
}

function buildPtyRunnerSource({ scriptPath, statePath, token }) {
  if (!scriptPath || !statePath || !token) throw new Error('scriptPath, statePath, and token are required');
  return [
    'import json',
    'import os',
    'import pty',
    'import sys',
    '',
    `SCRIPT_PATH = ${JSON.stringify(scriptPath)}`,
    `STATE_PATH = ${JSON.stringify(statePath)}`,
    `TOKEN = ${JSON.stringify(token)}`,
    '',
    'try:',
    '    os.setsid()',
    'except PermissionError:',
    '    pass',
    'state = {"token": TOKEN, "pid": os.getpid(), "pgid": os.getpgid(0)}',
    'with open(STATE_PATH, "w", encoding="utf-8") as state_file:',
    '    json.dump(state, state_file)',
    'try:',
    '    exit_code = pty.spawn([sys.executable, "-u", SCRIPT_PATH])',
    'finally:',
    '    try:',
    '        os.unlink(STATE_PATH)',
    '    except FileNotFoundError:',
    '        pass',
    'sys.exit(exit_code if isinstance(exit_code, int) else 0)',
    '',
  ].join('\n');
}

function buildRunCommand(options) {
  const source = buildPtyRunnerSource(options);
  return `python3 -u -c ${shellQuote(source)} &`;
}

function buildResizeCommand(columns, rows) {
  assertPositiveInteger(columns, 'columns');
  assertPositiveInteger(rows, 'rows');
  return `stty cols ${columns} rows ${rows}`;
}

function buildProcessGroupStopCommand({ statePath, token, graceMs = 800 }) {
  if (!statePath || !token) throw new Error('statePath and token are required');
  assertPositiveInteger(graceMs, 'graceMs');
  const source = [
    'import json',
    'import os',
    'import signal',
    'import time',
    `STATE_PATH = ${JSON.stringify(statePath)}`,
    `TOKEN = ${JSON.stringify(token)}`,
    `GRACE = ${graceMs / 1000}`,
    'with open(STATE_PATH, "r", encoding="utf-8") as state_file:',
    '    state = json.load(state_file)',
    'if state.get("token") != TOKEN:',
    '    raise SystemExit("process token mismatch")',
    'pgid = int(state["pgid"])',
    'try:',
    '    os.killpg(pgid, signal.SIGTERM)',
    'except ProcessLookupError:',
    '    raise SystemExit(0)',
    'time.sleep(GRACE)',
    'try:',
    '    os.killpg(pgid, signal.SIGKILL)',
    'except ProcessLookupError:',
    '    pass',
  ].join('\n');
  return `python3 -u -c ${shellQuote(source)}`;
}

module.exports = {
  buildProcessGroupStopCommand,
  buildPtyRunnerSource,
  buildResizeCommand,
  buildRunCommand,
};
