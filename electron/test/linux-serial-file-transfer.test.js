const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const {
  ChunkedFileTransfer,
  DEFAULT_MAX_FILE_SIZE,
  MAX_CHUNK_SIZE,
  buildFileTransferAgentSource,
  crc32,
} = require('../python-runtime/linux-serial-shell/file-transfer');

test('writes sequenced CRC chunks with ACK retry and verifies the final SHA-256', async () => {
  const calls = [];
  let firstChunkAttempt = true;
  const transfer = new ChunkedFileTransfer({
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'file.write.chunk' && firstChunkAttempt) {
        firstChunkAttempt = false;
        return { ack: false, reason: 'retry' };
      }
      if (method === 'file.write.chunk') {
        return {
          ack: true,
          sequence: params.sequence,
          crc32: params.crc32,
        };
      }
      if (method === 'file.write.commit') return { sha256: params.sha256 };
      return { ack: true };
    },
    chunkSize: 3,
    retryLimit: 2,
  });

  const result = await transfer.writeFile('/data/main.py', Buffer.from('abcdef'));

  assert.equal(result.sha256, createHash('sha256').update('abcdef').digest('hex'));
  assert.equal(calls[0].method, 'file.write.begin');
  assert.equal(calls.filter(call => call.method === 'file.write.chunk').length, 3);
  assert.equal(calls[1].params.sequence, 0);
  assert.equal(calls[1].params.crc32, crc32(Buffer.from('abc')));
  assert.equal(calls[2].params.sequence, 0);
  assert.equal(calls.at(-1).method, 'file.write.commit');
  assert.equal(calls.at(-1).params.sha256, result.sha256);
});

test('limits retries to three, file size, and one concurrent transfer', async () => {
  let attempts = 0;
  const retrying = new ChunkedFileTransfer({
    request: async method => {
      if (method === 'file.write.chunk') {
        attempts += 1;
        return { ack: false };
      }
      return { ack: true };
    },
    chunkSize: 8,
    retryLimit: 3,
  });
  await assert.rejects(
    retrying.writeFile('/data/retry.bin', Buffer.from('x')),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(attempts, 4);

  const limited = new ChunkedFileTransfer({
    request: async () => ({ ack: true }),
    maxFileSize: 4,
  });
  await assert.rejects(
    limited.writeFile('/data/large.bin', Buffer.alloc(5)),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );

  let releaseBegin;
  const beginBlocked = new Promise(resolve => {
    releaseBegin = resolve;
  });
  const digest = createHash('sha256').update('a').digest('hex');
  const single = new ChunkedFileTransfer({
    request: async method => {
      if (method === 'file.write.begin') await beginBlocked;
      if (method === 'file.write.chunk') return { ack: true, sequence: 0, crc32: crc32('a') };
      if (method === 'file.write.commit') return { sha256: digest };
      return { ack: true };
    },
  });
  const first = single.writeFile('/data/first.bin', Buffer.from('a'));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(
    single.writeFile('/data/second.bin', Buffer.from('b')),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  releaseBegin();
  await first;
});

test('uses a 32 MiB default file limit before starting a remote transfer', async () => {
  assert.equal(DEFAULT_MAX_FILE_SIZE, 32 * 1024 * 1024);
  let requests = 0;
  const transfer = new ChunkedFileTransfer({
    request: async () => {
      requests += 1;
      return { ack: true };
    },
  });

  await assert.rejects(
    transfer.writeFile('/data/too-large.bin', Buffer.alloc(DEFAULT_MAX_FILE_SIZE + 1)),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(requests, 0);
});

test('enforces the 48 KiB chunk maximum for writes and incoming read chunks', async () => {
  assert.equal(MAX_CHUNK_SIZE, 48 * 1024);
  assert.throws(
    () => new ChunkedFileTransfer({
      request: async () => ({ ack: true }),
      chunkSize: MAX_CHUNK_SIZE + 1,
    }),
    /chunkSize/i,
  );

  let writeRequests = 0;
  const writer = new ChunkedFileTransfer({
    request: async () => {
      writeRequests += 1;
      return { ack: true };
    },
  });
  await assert.rejects(
    writer.writeFile('/data/chunk.bin', Buffer.from('x'), {
      chunkSize: MAX_CHUNK_SIZE + 1,
    }),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(writeRequests, 0);

  const oversized = Buffer.alloc(MAX_CHUNK_SIZE + 1, 0x61);
  const digest = createHash('sha256').update(oversized).digest('hex');
  const calls = [];
  const reader = new ChunkedFileTransfer({
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'file.read.begin') {
        return { size: oversized.length, chunks: 1, sha256: digest };
      }
      if (method === 'file.read.chunk') {
        return {
          sequence: 0,
          crc32: crc32(oversized),
          dataBase64: oversized.toString('base64'),
        };
      }
      return { ack: true };
    },
  });

  await assert.rejects(
    reader.readFile('/data/oversized-chunk.bin'),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(calls[0].params.chunkSize, reader.chunkSize);
});

test('ends a serial read transfer after the final SHA-256 is verified', async () => {
  const calls = [];
  const data = Buffer.from('serial read');
  const digest = createHash('sha256').update(data).digest('hex');
  const transfer = new ChunkedFileTransfer({
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'file.read.begin') {
        return { size: data.length, chunks: 1, sha256: digest };
      }
      if (method === 'file.read.chunk') {
        return {
          sequence: params.sequence,
          crc32: crc32(data),
          dataBase64: data.toString('base64'),
        };
      }
      return { ack: true };
    },
  });

  const result = await transfer.readFile('/data/read.bin');

  assert.deepEqual(result.data, data);
  assert.equal(calls.at(-1).method, 'file.read.end');
  assert.deepEqual(calls.at(-1).params, { path: '/data/read.bin' });
});

test('ends a serial read transfer when chunk validation fails', async () => {
  const calls = [];
  const data = Buffer.from('bad crc');
  const transfer = new ChunkedFileTransfer({
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'file.read.begin') {
        return {
          size: data.length,
          chunks: 1,
          sha256: createHash('sha256').update(data).digest('hex'),
        };
      }
      if (method === 'file.read.chunk') {
        return {
          sequence: params.sequence,
          crc32: crc32(data) + 1,
          dataBase64: data.toString('base64'),
        };
      }
      return { ack: true };
    },
  });

  await assert.rejects(
    transfer.readFile('/data/read.bin'),
    error => error.code === 'FILE_TRANSFER_FAILED',
  );
  assert.equal(calls.at(-1).method, 'file.read.end');
  assert.deepEqual(calls.at(-1).params, { path: '/data/read.bin' });
});

test('retries a serial read chunk when its CRC validation fails', async () => {
  const data = Buffer.from('retry read');
  const digest = createHash('sha256').update(data).digest('hex');
  let chunkAttempts = 0;
  const transfer = new ChunkedFileTransfer({
    request: async (method, params) => {
      if (method === 'file.read.begin') {
        return { size: data.length, chunks: 1, sha256: digest };
      }
      if (method === 'file.read.chunk') {
        chunkAttempts += 1;
        return {
          sequence: params.sequence,
          crc32: crc32(data) + (chunkAttempts === 1 ? 1 : 0),
          dataBase64: data.toString('base64'),
        };
      }
      return { ack: true };
    },
    retryLimit: 3,
  });

  const result = await transfer.readFile('/data/retry-read.bin');

  assert.deepEqual(result.data, data);
  assert.equal(chunkAttempts, 2);
});

test('agent source uses checksum, chunk CRC, temporary files, and os.replace for atomic writes', () => {
  const source = buildFileTransferAgentSource();

  assert.match(source, /hashlib\.sha256/);
  assert.match(source, /tempfile/);
  assert.match(source, /os\.replace/);
  assert.match(source, /zlib\.crc32/);
  assert.match(source, /ACK/);
});
