const MSG_REQUEST = 0x01;
const MSG_RESPONSE = 0x02;
const MSG_EVENT = 0x03;
const MSG_FRAME = 0x04;

const MAGIC = Buffer.from('CM', 'ascii');
const HEADER_SIZE = 7;
const DEFAULT_MAX_FRAME_SIZE = 50 * 1024 * 1024;
const DEFAULT_MAX_MESSAGE_SIZE = 64 * 1024 * 1024;

function encodeFrame(type, payload) {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new TypeError('CanMV frame type must be one byte');
  }
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(header, 0);
  header[2] = type;
  header.writeUInt32LE(body.length, 3);
  return Buffer.concat([header, body]);
}

function encodeJsonFrame(type, value) {
  return encodeFrame(type, Buffer.from(JSON.stringify(value), 'utf8'));
}

class CanmvFrameDecoder {
  constructor(options = {}) {
    this.onMessage = options.onMessage || (() => {});
    this.onFrame = options.onFrame || (() => {});
    this.maxFrameSize = options.maxFrameSize || DEFAULT_MAX_FRAME_SIZE;
    this.maxMessageSize = options.maxMessageSize || DEFAULT_MAX_MESSAGE_SIZE;
    this.buffer = Buffer.alloc(0);
    this.discardBytes = 0;
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return;
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    if (this.discardBytes > 0) {
      const skipped = Math.min(this.discardBytes, incoming.length);
      this.discardBytes -= skipped;
      incoming = incoming.subarray(skipped);
      if (incoming.length === 0) return;
    }

    this.buffer = this.buffer.length === 0
      ? incoming
      : Buffer.concat([this.buffer, incoming]);
    this.consume();
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.discardBytes = 0;
  }

  consume() {
    while (true) {
      if (this.discardBytes > 0) {
        const skipped = Math.min(this.discardBytes, this.buffer.length);
        this.discardBytes -= skipped;
        this.buffer = this.buffer.subarray(skipped);
        if (this.discardBytes > 0) return;
      }

      if (this.buffer.length < HEADER_SIZE) return;
      if (this.buffer[0] !== MAGIC[0] || this.buffer[1] !== MAGIC[1]) {
        this.resynchronize();
        if (this.buffer.length < HEADER_SIZE) return;
        continue;
      }

      const type = this.buffer[2];
      const payloadLength = this.buffer.readUInt32LE(3);
      const maximum = type === MSG_FRAME ? this.maxFrameSize : this.maxMessageSize;
      this.buffer = this.buffer.subarray(HEADER_SIZE);

      if (payloadLength > maximum) {
        this.discardBytes = payloadLength;
        continue;
      }
      if (this.buffer.length < payloadLength) {
        const header = Buffer.alloc(HEADER_SIZE);
        MAGIC.copy(header, 0);
        header[2] = type;
        header.writeUInt32LE(payloadLength, 3);
        this.buffer = Buffer.concat([header, this.buffer]);
        return;
      }

      const payload = this.buffer.subarray(0, payloadLength);
      this.buffer = this.buffer.subarray(payloadLength);
      this.dispatch(type, payload);
    }
  }

  resynchronize() {
    const nextMagic = this.buffer.indexOf(MAGIC, 1);
    if (nextMagic >= 0) {
      this.buffer = this.buffer.subarray(nextMagic);
      return;
    }
    this.buffer = this.buffer[this.buffer.length - 1] === MAGIC[0]
      ? this.buffer.subarray(this.buffer.length - 1)
      : Buffer.alloc(0);
  }

  dispatch(type, payload) {
    if (type === MSG_REQUEST || type === MSG_RESPONSE || type === MSG_EVENT) {
      try {
        const message = JSON.parse(payload.toString('utf8'));
        if (message && typeof message === 'object') {
          this.onMessage(message);
        }
      } catch {
        // A corrupted JSON payload is isolated to its frame.
      }
      return;
    }
    if (type !== MSG_FRAME || payload.length < 8) return;

    const frameId = payload.readUInt32LE(0);
    const jpeg = payload.subarray(4);
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return;

    let end = jpeg.length;
    for (let index = jpeg.length - 2; index >= 2; index--) {
      if (jpeg[index] === 0xff && jpeg[index + 1] === 0xd9) {
        end = index + 2;
        break;
      }
    }
    this.onFrame(frameId, jpeg.subarray(0, end));
  }
}

module.exports = {
  CanmvFrameDecoder,
  MAGIC,
  MSG_EVENT,
  MSG_FRAME,
  MSG_REQUEST,
  MSG_RESPONSE,
  encodeFrame,
  encodeJsonFrame,
};
