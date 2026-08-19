const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FRAME_HEADER_SIZE,
  MAGIC,
  MAX_PAYLOAD_LENGTH,
  VERSION,
  FrameDecoder,
  TYPES,
  createProtocolMagic,
  crc32,
  encodeFrame,
} = require('../python-runtime/linux-serial-shell/protocol');

test('uses a random 16-byte magic and exposes all protocol frame types', () => {
  assert.equal(MAGIC.length, 16);
  const first = createProtocolMagic();
  const second = createProtocolMagic();
  assert.equal(first.length, 16);
  assert.equal(second.length, 16);
  assert.notDeepEqual(first, second);
  assert.deepEqual(
    Object.keys(TYPES).sort(),
    ['ACK', 'CONTROL', 'ERROR', 'FILE', 'HEARTBEAT', 'PREVIEW', 'TERMINAL'],
  );
});

test('encodes the 32-byte magic/version/type/flags/sequence/length/CRC header', () => {
  const payload = Buffer.from('hello');
  const magic = Buffer.alloc(16, 0xa5);
  const frame = encodeFrame(TYPES.CONTROL, payload, {
    magic,
    flags: 0x1234,
    sequence: 0x10203040,
  });

  assert.equal(FRAME_HEADER_SIZE, 32);
  assert.equal(frame.length, FRAME_HEADER_SIZE + payload.length);
  assert.deepEqual(frame.subarray(0, 16), magic);
  assert.equal(frame.readUInt8(16), VERSION);
  assert.equal(frame.readUInt8(17), TYPES.CONTROL);
  assert.equal(frame.readUInt16BE(18), 0x1234);
  assert.equal(frame.readUInt32BE(20), 0x10203040);
  assert.equal(frame.readUInt32BE(24), payload.length);
  assert.equal(frame.readUInt32BE(28), crc32(payload));
  assert.deepEqual(frame.subarray(FRAME_HEADER_SIZE), payload);
});

test('rejects payloads larger than the protocol limit', () => {
  assert.throws(
    () => encodeFrame(TYPES.CONTROL, Buffer.alloc(MAX_PAYLOAD_LENGTH + 1)),
    /payload length/i,
  );
});

test('decodes split, concatenated, and noisy frames by resynchronizing on magic', () => {
  const magic = Buffer.alloc(16, 0x31);
  const first = encodeFrame(TYPES.CONTROL, 'first', {
    magic,
    flags: 3,
    sequence: 10,
  });
  const second = encodeFrame(TYPES.TERMINAL, 'second', {
    magic,
    sequence: 11,
  });
  const decoder = new FrameDecoder({ magic });

  assert.deepEqual(
    decoder.push(Buffer.concat([Buffer.from('shell echo and kernel noise'), first.subarray(0, 9)])),
    [],
  );
  assert.deepEqual(decoder.push(Buffer.concat([first.subarray(9), second])), [
    {
      version: VERSION,
      type: TYPES.CONTROL,
      flags: 3,
      sequence: 10,
      payload: Buffer.from('first'),
    },
    {
      version: VERSION,
      type: TYPES.TERMINAL,
      flags: 0,
      sequence: 11,
      payload: Buffer.from('second'),
    },
  ]);
});

test('skips bad version, oversized length, and CRC frames and decodes the next valid frame', () => {
  const magic = Buffer.alloc(16, 0x77);
  const invalidVersion = encodeFrame(TYPES.CONTROL, 'bad-version', { magic });
  invalidVersion[16] = VERSION + 1;
  const invalidLength = encodeFrame(TYPES.CONTROL, 'bad-length', { magic });
  invalidLength.writeUInt32BE(MAX_PAYLOAD_LENGTH + 1, 24);
  const invalidCrc = encodeFrame(TYPES.CONTROL, 'bad-crc', { magic });
  invalidCrc[FRAME_HEADER_SIZE] ^= 0xff;
  const valid = encodeFrame(TYPES.HEARTBEAT, 'valid', {
    magic,
    sequence: 99,
  });
  const decoder = new FrameDecoder({ magic });

  assert.deepEqual(decoder.push(Buffer.concat([
    invalidVersion,
    invalidLength,
    invalidCrc,
    valid,
  ])), [
    {
      version: VERSION,
      type: TYPES.HEARTBEAT,
      flags: 0,
      sequence: 99,
      payload: Buffer.from('valid'),
    },
  ]);
});
