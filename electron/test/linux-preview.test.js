const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JpegStreamParser,
  createPreviewCommand,
} = require('../python-runtime/linux-shared/jpeg-stream');

test('parses JPEG frames split across arbitrary SSH stdout chunks', () => {
  const parser = new JpegStreamParser();
  const frames = [];
  parser.on('frame', frame => frames.push(frame));

  const first = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
  const second = Buffer.from([0xff, 0xd8, 0x03, 0xff, 0xd9]);
  parser.push(first.subarray(0, 3));
  parser.push(Buffer.concat([first.subarray(3), second.subarray(0, 2)]));
  parser.push(second.subarray(2));

  assert.deepEqual(frames, [first, second]);
});

test('drops noise and limits oversized frames', () => {
  const parser = new JpegStreamParser({ maxFrameBytes: 8 });
  const frames = [];
  parser.on('frame', frame => frames.push(frame));
  parser.push(Buffer.from([1, 2, 3, 0xff, 0xd8, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]));
  assert.equal(frames.length, 0);
  assert.equal(parser.droppedFrames, 1);
});

test('builds an unbuffered preview command with an override for board camera tools', () => {
  assert.match(createPreviewCommand({ command: 'rpicam-vid --codec mjpeg -t 0 -o -' }), /rpicam-vid/);
  assert.match(createPreviewCommand({}), /python3 -u/);
});
