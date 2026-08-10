const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CanmvFrameDecoder,
  MSG_EVENT,
  MSG_FRAME,
  MSG_REQUEST,
  MSG_RESPONSE,
  encodeFrame,
  encodeJsonFrame,
} = require('../python-runtime/protocol');

test('encodes a JSON request with the CM frame header', () => {
  const frame = encodeJsonFrame(MSG_REQUEST, {
    id: 7,
    method: 'detectBoards',
    params: {},
  });

  assert.equal(frame.subarray(0, 2).toString('ascii'), 'CM');
  assert.equal(frame[2], MSG_REQUEST);
  assert.equal(frame.readUInt32LE(3), frame.length - 7);
  assert.deepEqual(JSON.parse(frame.subarray(7).toString('utf8')), {
    id: 7,
    method: 'detectBoards',
    params: {},
  });
});

test('decodes fragmented messages and resynchronizes after stdout noise', () => {
  const messages = [];
  const decoder = new CanmvFrameDecoder({
    onMessage: message => messages.push(message),
  });
  const response = encodeJsonFrame(MSG_RESPONSE, { id: 1, result: { boards: [] } });
  const event = encodeJsonFrame(MSG_EVENT, { event: 'scriptOutput', params: { text: 'ok' } });
  const stream = Buffer.concat([Buffer.from('backend log\nC'), response, event]);

  decoder.push(stream.subarray(0, 5));
  decoder.push(stream.subarray(5, 17));
  decoder.push(stream.subarray(17));

  assert.deepEqual(messages, [
    { id: 1, result: { boards: [] } },
    { event: 'scriptOutput', params: { text: 'ok' } },
  ]);
});

test('extracts frame IDs and trims JPEG padding after the last EOI marker', () => {
  const frames = [];
  const decoder = new CanmvFrameDecoder({
    onFrame: (frameId, jpeg) => frames.push({ frameId, jpeg: Buffer.from(jpeg) }),
  });
  const payload = Buffer.alloc(12);
  payload.writeUInt32LE(42, 0);
  Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9, 0x00, 0x00]).copy(payload, 4);

  decoder.push(encodeFrame(MSG_FRAME, payload));

  assert.equal(frames.length, 1);
  assert.equal(frames[0].frameId, 42);
  assert.deepEqual(frames[0].jpeg, Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]));
});

test('discards an oversized video payload and continues with the next frame', () => {
  const messages = [];
  const decoder = new CanmvFrameDecoder({
    maxFrameSize: 8,
    onMessage: message => messages.push(message),
  });
  const oversized = encodeFrame(MSG_FRAME, Buffer.alloc(12, 0xaa));
  const valid = encodeJsonFrame(MSG_RESPONSE, { id: 9, result: { running: false } });

  decoder.push(Buffer.concat([oversized, valid]));

  assert.deepEqual(messages, [{ id: 9, result: { running: false } }]);
});
