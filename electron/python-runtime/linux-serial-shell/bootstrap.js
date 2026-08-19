'use strict';

const { createHash } = require('node:crypto');

const SHA_MARKER_PREFIX = '__AILY_HELPER_SHA__';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function validateRemotePath(remotePath) {
  if (typeof remotePath !== 'string'
    || !remotePath.startsWith('/')
    || remotePath.includes('\0')
    || remotePath.includes('\\')
    || remotePath.split('/').includes('..')) {
    throw new Error('remotePath must be an absolute normalized POSIX path');
  }
  return remotePath;
}

function buildBase64HelperBootstrap(source, remotePath, { chunkSize = 768 } = {}) {
  const targetPath = validateRemotePath(remotePath);
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 4096) {
    throw new RangeError('chunkSize must be an integer between 1 and 4096');
  }

  const sourceBuffer = Buffer.from(String(source), 'utf8');
  const encoded = sourceBuffer.toString('base64');
  const sha256 = createHash('sha256').update(sourceBuffer).digest('hex');
  const tempPath = `${targetPath}.part`;
  const commands = [`: > ${shellQuote(tempPath)}`];
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize);
    commands.push(
      `printf '%s' ${shellQuote(chunk)} | base64 -d >> ${shellQuote(tempPath)}`,
    );
  }

  const verifySource = [
    'import hashlib,os,sys',
    `source_path=${JSON.stringify(tempPath)}`,
    `target_path=${JSON.stringify(targetPath)}`,
    `expected=${JSON.stringify(sha256)}`,
    'with open(source_path,"rb") as source_file:',
    '    actual=hashlib.sha256(source_file.read()).hexdigest()',
    'if actual != expected:',
    '    raise SystemExit("helper SHA-256 mismatch")',
    'os.replace(source_path,target_path)',
    `print(${JSON.stringify(SHA_MARKER_PREFIX)}+actual,flush=True)`,
  ].join('\n');
  commands.push(`python3 -u -c ${shellQuote(verifySource)}`);
  commands.push(`chmod +x ${shellQuote(targetPath)}`);

  return {
    commands,
    encoded,
    remotePath: targetPath,
    sha256,
    shaMarker: `${SHA_MARKER_PREFIX}${sha256}`,
    tempPath,
  };
}

function buildHelperStartCommand(remotePath) {
  return `exec python3 -u ${shellQuote(validateRemotePath(remotePath))}`;
}

module.exports = {
  SHA_MARKER_PREFIX,
  buildBase64HelperBootstrap,
  buildHelperStartCommand,
  shellQuote,
  validateRemotePath,
};
