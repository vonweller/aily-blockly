const crypto = require('node:crypto');
const path = require('node:path');
const { RUNTIME_ERROR_CODES, runtimeError } = require('../runtime-errors');

function validateEndpoint(value) {
  if (!value || typeof value !== 'object' || typeof value.kind !== 'string') {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, 'A runtime endpoint is required');
  }
  if (value.kind === 'ssh') return validateSshEndpoint(value);
  if (value.kind === 'serial-shell') return validateSerialEndpoint(value);
  if (value.kind === 'canmv') return validateCanmvEndpoint(value);
  throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, `Unsupported runtime endpoint: ${value.kind}`);
}

function validateSshEndpoint(value) {
  const host = cleanRequired(value.host, 'SSH host');
  const username = cleanRequired(value.username, 'SSH username');
  if (!/^[a-zA-Z0-9._:-]+$/.test(host) || /[;&|`$()<>\s\0\r\n]/.test(host)) {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, 'SSH host is invalid');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username) || /[\0\r\n]/.test(username)) {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, 'SSH username is invalid');
  }
  const port = integerInRange(value.port ?? 22, 1, 65535, 'SSH port');
  const result = { kind: 'ssh', host, port, username };
  for (const key of ['credentialId', 'privateKeyPath']) {
    if (value[key] !== undefined) {
      const text = cleanRequired(value[key], key);
      if (text.includes('\0')) {
        throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, `${key} is invalid`);
      }
      result[key] = text;
    }
  }
  return result;
}

function validateSerialEndpoint(value) {
  const port = cleanRequired(value.port, 'serial port');
  const baudRate = integerInRange(value.baudRate ?? 115200, 1200, 12000000, 'serial baud rate');
  if (/[;\0\r\n]/.test(port)) {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, 'serial port is invalid');
  }
  return { kind: 'serial-shell', port, baudRate };
}

function validateCanmvEndpoint(value) {
  const port = cleanRequired(value.port, 'CanMV port');
  const baudRate = integerInRange(value.baudRate ?? 115200, 1200, 12000000, 'CanMV baud rate');
  return { kind: 'canmv', port, baudRate };
}

function createLaunchPlan(sessionId, runId, pythonExecutable) {
  const safeSessionId = sanitizeSessionPart(sessionId);
  const safeRunId = sanitizeSessionPart(runId);
  const executable = requiredAbsolutePosixPath(pythonExecutable, 'python executable');
  const token = crypto.randomUUID();
  const controlNonce = crypto.randomUUID();
  const scriptPath = `/tmp/aily-runtime/${safeSessionId}/main.py`;
  const controlPath = `/tmp/aily-runtime/${safeSessionId}/${safeRunId}.json`;
  const launcherSource = [
    'import json,os,sys',
    `script_path=${JSON.stringify(scriptPath)}`,
    `control_path=${JSON.stringify(controlPath)}`,
    `token=${JSON.stringify(token)}`,
    `run_id=${JSON.stringify(safeRunId)}`,
    `control_nonce=${JSON.stringify(controlNonce)}`,
    'os.makedirs(os.path.dirname(script_path),exist_ok=True)',
    'try:',
    ' os.setsid()',
    'except PermissionError:',
    ' pass',
    'pid=os.getpid()',
    'pgid=os.getpgid(0)',
    'with open("/proc/%d/stat"%pid,"r",encoding="utf-8") as proc_stat:',
    ' starttime=proc_stat.read().rsplit(")",1)[1].split()[19]',
    'state={"pid":pid,"pgid":pgid,"token":token,"starttime":starttime,"runId":run_id}',
    'temporary=control_path+".tmp-"+token',
    'with open(temporary,"w",encoding="utf-8") as control_file:',
    ' json.dump(state,control_file,separators=(",",":"))',
    ' control_file.flush()',
    ' os.fsync(control_file.fileno())',
    'os.replace(temporary,control_path)',
    'print(control_nonce+json.dumps({"type":"started",**state},separators=(",",":")),flush=True)',
    `os.execv(${JSON.stringify(executable)},[${JSON.stringify(path.posix.basename(executable))},"-u",script_path])`,
  ].join('\n');
  const encodedLauncher = Buffer.from(launcherSource, 'utf8').toString('base64');
  const command = `${shellQuote(executable)} -u -c ${shellQuote(`import base64;exec(compile(base64.b64decode('${encodedLauncher}'),'<aily-launcher>','exec'))`)}`;
  return {
    sessionId: safeSessionId,
    runId: safeRunId,
    token,
    controlNonce,
    scriptPath,
    controlPath,
    launcherSource,
    command,
  };
}

function requiredAbsolutePosixPath(value, label = 'path') {
  if (
    typeof value !== 'string'
    || !value
    || !value.startsWith('/')
    || value.includes('\0')
    || value.includes('\\')
    || path.posix.normalize(value) !== value
    || value.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label} must be a strict absolute POSIX path`);
  }
  return value;
}

function sanitizeSessionPart(value) {
  const parts = String(value ?? '').split('/').filter(part => part && part !== '.' && part !== '..');
  const normalized = parts.join('-').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'session';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function cleanRequired(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, `${label} is required`);
  }
  return value.trim();
}

function integerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw runtimeError(RUNTIME_ERROR_CODES.INVALID_ENDPOINT, `${label} must be between ${min} and ${max}`);
  }
  return value;
}

module.exports = {
  validateEndpoint,
  createLaunchPlan,
  requiredAbsolutePosixPath,
  sanitizeSessionPart,
  shellQuote,
};
