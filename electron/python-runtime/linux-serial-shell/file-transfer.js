'use strict';

const { createHash } = require('node:crypto');
const {
  RUNTIME_ERROR_CODES,
  RuntimeError,
  runtimeError,
} = require('../runtime-errors');
const { validateBoardPath } = require('../linux-shared/posix-path');
const { crc32 } = require('./protocol');

const DEFAULT_CHUNK_SIZE = 32 * 1024;
const MAX_CHUNK_SIZE = 48 * 1024;
const DEFAULT_MAX_FILE_SIZE = 32 * 1024 * 1024;
const MAX_RETRY_LIMIT = 3;

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError('file data must be a Buffer, Uint8Array, or string');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileTransferError(message, cause, operation) {
  if (cause instanceof RuntimeError && cause.code === RUNTIME_ERROR_CODES.FILE_TRANSFER_FAILED) {
    return cause;
  }
  return runtimeError(RUNTIME_ERROR_CODES.FILE_TRANSFER_FAILED, message, {
    cause,
    details: {
      operation,
      retryable: true,
    },
  });
}

class ChunkedFileTransfer {
  constructor({
    request,
    chunkSize = DEFAULT_CHUNK_SIZE,
    retryLimit = MAX_RETRY_LIMIT,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
  } = {}) {
    if (typeof request !== 'function') throw new TypeError('request function is required');
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
      throw new RangeError(`chunkSize must be between 1 and ${MAX_CHUNK_SIZE}`);
    }
    if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > MAX_RETRY_LIMIT) {
      throw new RangeError(`retryLimit must be between 0 and ${MAX_RETRY_LIMIT}`);
    }
    if (!Number.isInteger(maxFileSize) || maxFileSize < 0 || maxFileSize > DEFAULT_MAX_FILE_SIZE) {
      throw new RangeError(`maxFileSize must be between 0 and ${DEFAULT_MAX_FILE_SIZE}`);
    }
    this.request = request;
    this.chunkSize = chunkSize;
    this.retryLimit = retryLimit;
    this.maxFileSize = maxFileSize;
    this.activeOperation = null;
  }

  async writeFile(filePath, data, { chunkSize = this.chunkSize } = {}) {
    const path = this.validatePath(filePath);
    const buffer = toBuffer(data);
    this.validateSize(buffer.length);
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
      throw fileTransferError('Invalid serial file chunk size', undefined, 'writeFile');
    }
    return this.withExclusiveTransfer('writeFile', async () => {
      const digest = sha256(buffer);
      const total = Math.ceil(buffer.length / chunkSize);
      try {
        await this.request('file.write.begin', {
          path,
          size: buffer.length,
          chunks: total,
          sha256: digest,
        });

        for (let sequence = 0; sequence < total; sequence += 1) {
          const chunk = buffer.subarray(sequence * chunkSize, (sequence + 1) * chunkSize);
          const checksum = crc32(chunk);
          await this.withRetry(async () => {
            const response = await this.request('file.write.chunk', {
              path,
              index: sequence,
              sequence,
              offset: sequence * chunkSize,
              length: chunk.length,
              crc32: checksum,
              dataBase64: chunk.toString('base64'),
            });
            if (!response || response.ack !== true) {
              throw new Error(response?.reason || `chunk ${sequence} was not acknowledged`);
            }
            if (response.sequence !== undefined && response.sequence !== sequence) {
              throw new Error(`chunk ${sequence} ACK sequence mismatch`);
            }
            if (response.crc32 !== undefined && response.crc32 !== checksum) {
              throw new Error(`chunk ${sequence} ACK CRC mismatch`);
            }
          });
        }

        const committed = await this.request('file.write.commit', { path, sha256: digest });
        if (!committed || committed.sha256 !== digest) {
          throw new Error('remote file SHA-256 mismatch after commit');
        }
        return {
          path,
          size: buffer.length,
          sha256: digest,
          chunks: total,
        };
      } catch (error) {
        await this.request('file.write.abort', { path }).catch(() => undefined);
        throw fileTransferError(`Failed to write ${path} over serial`, error, 'writeFile');
      }
    });
  }

  async readFile(filePath) {
    const path = this.validatePath(filePath);
    return this.withExclusiveTransfer('readFile', async () => {
      let began = false;
      try {
        const meta = await this.request('file.read.begin', {
          path,
          chunkSize: this.chunkSize,
        });
        began = true;
        if (!meta || !Number.isInteger(meta.size) || !Number.isInteger(meta.chunks)) {
          throw new Error('invalid remote file metadata');
        }
        this.validateSize(meta.size);
        const chunks = [];
        for (let sequence = 0; sequence < meta.chunks; sequence += 1) {
          const chunk = await this.withRetry(async () => {
            const response = await this.request(
              'file.read.chunk',
              { path, index: sequence, sequence },
            );
            if (!response
              || (response.sequence ?? response.index) !== sequence
              || typeof response.dataBase64 !== 'string') {
              throw new Error(`invalid file chunk ${sequence}`);
            }
            const received = Buffer.from(response.dataBase64, 'base64');
            if (received.length > MAX_CHUNK_SIZE) {
              throw new Error(`file chunk ${sequence} exceeds the serial chunk limit`);
            }
            const checksum = crc32(received);
            if (response.crc32 !== undefined && checksum !== response.crc32) {
              throw new Error(`file chunk ${sequence} CRC mismatch`);
            }
            await this.request('file.read.ack', {
              path,
              sequence,
              crc32: checksum,
            });
            return received;
          });
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (data.length !== meta.size) throw new Error('remote file size mismatch');
        const digest = sha256(data);
        if (!meta.sha256 || meta.sha256 !== digest) throw new Error('remote file SHA-256 mismatch');
        return { path, data, size: data.length, sha256: digest };
      } catch (error) {
        throw fileTransferError(`Failed to read ${path} over serial`, error, 'readFile');
      } finally {
        if (began) {
          await this.request('file.read.end', { path }).catch(() => undefined);
        }
      }
    });
  }

  list(path) {
    return this.simpleRequest('file.list', { path: this.validatePath(path) });
  }

  stat(path) {
    return this.simpleRequest('file.stat', { path: this.validatePath(path) });
  }

  delete(path) {
    return this.simpleRequest('file.delete', { path: this.validatePath(path) });
  }

  rename(oldPath, newPath) {
    return this.simpleRequest('file.rename', {
      oldPath: this.validatePath(oldPath),
      newPath: this.validatePath(newPath),
    });
  }

  mkdir(path) {
    return this.simpleRequest('file.mkdir', { path: this.validatePath(path) });
  }

  rmdir(path) {
    return this.simpleRequest('file.rmdir', { path: this.validatePath(path) });
  }

  async simpleRequest(operation, params) {
    try {
      return await this.request(operation, params);
    } catch (error) {
      throw fileTransferError(`Serial ${operation} failed`, error, operation);
    }
  }

  validatePath(path) {
    try {
      return validateBoardPath(path);
    } catch (error) {
      throw fileTransferError('Invalid serial file path', error, 'path');
    }
  }

  validateSize(size) {
    if (!Number.isInteger(size) || size < 0 || size > this.maxFileSize) {
      throw fileTransferError(
        `Serial file size exceeds the ${this.maxFileSize} byte limit`,
        undefined,
        'size',
      );
    }
  }

  async withExclusiveTransfer(operation, callback) {
    if (this.activeOperation) {
      throw fileTransferError(
        `Another serial file transfer is already active (${this.activeOperation})`,
        undefined,
        operation,
      );
    }
    this.activeOperation = operation;
    try {
      return await callback();
    } finally {
      this.activeOperation = null;
    }
  }

  async withRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      try {
        return await operation(attempt);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

function buildFileTransferAgentSource() {
  return [
    'import hashlib',
    'import os',
    'import tempfile',
    'import zlib',
    '',
    'def checksum(data):',
    '    return hashlib.sha256(data).hexdigest()',
    '',
    'def write_chunked(path, chunks, expected_sha256):',
    '    directory = os.path.dirname(path) or "."',
    '    fd, temp_path = tempfile.mkstemp(prefix=".lss-", dir=directory)',
    '    try:',
    '        with os.fdopen(fd, "wb") as output:',
    '            for sequence, expected_crc, chunk in chunks:',
    '                if zlib.crc32(chunk) & 0xffffffff != expected_crc:',
    '                    raise ValueError("chunk CRC mismatch")',
    '                output.write(chunk)',
    '                print("ACK", sequence, flush=True)',
    '        with open(temp_path, "rb") as input_file:',
    '            if checksum(input_file.read()) != expected_sha256:',
    '                raise ValueError("SHA-256 mismatch")',
    '        os.replace(temp_path, path)',
    '    finally:',
    '        if os.path.exists(temp_path):',
    '            os.unlink(temp_path)',
  ].join('\n');
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_FILE_SIZE,
  MAX_CHUNK_SIZE,
  MAX_RETRY_LIMIT,
  ChunkedFileTransfer,
  buildFileTransferAgentSource,
  crc32,
  sha256,
};
