'use strict';

const { randomBytes } = require('node:crypto');

const MAGIC_SIZE = 16;
const VERSION = 1;
const FRAME_HEADER_SIZE = 32;
const MAX_PAYLOAD_LENGTH = 16 * 1024 * 1024;

const TYPES = Object.freeze({
  CONTROL: 1,
  TERMINAL: 2,
  FILE: 3,
  PREVIEW: 4,
  ACK: 5,
  ERROR: 6,
  HEARTBEAT: 7,
});

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function createProtocolMagic() {
  return randomBytes(MAGIC_SIZE);
}

const MAGIC = createProtocolMagic();

function crc32(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let result = 0xffffffff;
  for (const byte of buffer) {
    result = CRC_TABLE[(result ^ byte) & 0xff] ^ (result >>> 8);
  }
  return (result ^ 0xffffffff) >>> 0;
}

function normalizePayload(payload = Buffer.alloc(0)) {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  throw new TypeError('payload must be a Buffer, Uint8Array, or string');
}

function normalizeMagic(value) {
  const magic = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (magic.length !== MAGIC_SIZE) {
    throw new RangeError(`protocol magic must be exactly ${MAGIC_SIZE} bytes`);
  }
  return magic;
}

function unsignedInteger(value, max, label) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an unsigned integer <= ${max}`);
  }
  return value;
}

function encodeFrame(type, payload, options = {}) {
  unsignedInteger(type, 0xff, 'frame type');
  const flags = unsignedInteger(options.flags ?? 0, 0xffff, 'frame flags');
  const sequence = unsignedInteger(options.sequence ?? 0, 0xffffffff, 'frame sequence');
  const version = unsignedInteger(options.version ?? VERSION, 0xff, 'frame version');
  const magic = normalizeMagic(options.magic || MAGIC);
  const body = normalizePayload(payload);
  if (body.length > MAX_PAYLOAD_LENGTH) {
    throw new RangeError(`payload length exceeds ${MAX_PAYLOAD_LENGTH} bytes`);
  }

  const frame = Buffer.allocUnsafe(FRAME_HEADER_SIZE + body.length);
  magic.copy(frame, 0);
  frame.writeUInt8(version, 16);
  frame.writeUInt8(type, 17);
  frame.writeUInt16BE(flags, 18);
  frame.writeUInt32BE(sequence, 20);
  frame.writeUInt32BE(body.length, 24);
  frame.writeUInt32BE(crc32(body), 28);
  body.copy(frame, FRAME_HEADER_SIZE);
  return frame;
}

class FrameDecoder {
  constructor({
    magic = MAGIC,
    maxPayloadLength = MAX_PAYLOAD_LENGTH,
    onDesync,
  } = {}) {
    this.magic = normalizeMagic(magic);
    if (!Number.isInteger(maxPayloadLength) || maxPayloadLength < 0 || maxPayloadLength > MAX_PAYLOAD_LENGTH) {
      throw new RangeError(`maxPayloadLength must be between 0 and ${MAX_PAYLOAD_LENGTH}`);
    }
    this.maxPayloadLength = maxPayloadLength;
    this.onDesync = typeof onDesync === 'function' ? onDesync : null;
    this.buffer = Buffer.alloc(0);
    this.desyncCount = 0;
  }

  push(chunk) {
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    if (input.length > 0) this.buffer = Buffer.concat([this.buffer, input]);
    const frames = [];

    while (this.buffer.length > 0) {
      const magicIndex = this.buffer.indexOf(this.magic);
      if (magicIndex < 0) {
        const retained = Math.min(this.buffer.length, MAGIC_SIZE - 1);
        if (this.buffer.length > retained) this.noteDesync('noise');
        this.buffer = this.buffer.subarray(this.buffer.length - retained);
        break;
      }
      if (magicIndex > 0) {
        this.noteDesync('noise');
        this.buffer = this.buffer.subarray(magicIndex);
      }
      if (this.buffer.length < FRAME_HEADER_SIZE) break;

      const version = this.buffer.readUInt8(16);
      const type = this.buffer.readUInt8(17);
      const flags = this.buffer.readUInt16BE(18);
      const sequence = this.buffer.readUInt32BE(20);
      const payloadLength = this.buffer.readUInt32BE(24);
      const expectedCrc = this.buffer.readUInt32BE(28);

      if (version !== VERSION) {
        this.discardCandidate('version');
        continue;
      }
      if (payloadLength > this.maxPayloadLength) {
        this.discardCandidate('length');
        continue;
      }

      const frameLength = FRAME_HEADER_SIZE + payloadLength;
      if (this.buffer.length < frameLength) break;
      const payload = this.buffer.subarray(FRAME_HEADER_SIZE, frameLength);
      if (crc32(payload) !== expectedCrc) {
        this.discardCandidate('crc');
        continue;
      }

      frames.push({
        version,
        type,
        flags,
        sequence,
        payload: Buffer.from(payload),
      });
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  discardCandidate(reason) {
    this.noteDesync(reason);
    this.buffer = this.buffer.subarray(1);
  }

  noteDesync(reason) {
    this.desyncCount += 1;
    this.onDesync?.({ reason, count: this.desyncCount });
  }
}

module.exports = {
  FRAME_HEADER_SIZE,
  MAGIC,
  MAGIC_SIZE,
  MAX_PAYLOAD_LENGTH,
  TYPES,
  VERSION,
  FrameDecoder,
  createProtocolMagic,
  crc32,
  encodeFrame,
  normalizeMagic,
};
