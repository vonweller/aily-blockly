const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JpegPreviewLimiter,
  SerialFrameScheduler,
} = require('../python-runtime/linux-serial-shell/preview');

test('defaults serial JPEG preview to 2 FPS', () => {
  const limiter = new JpegPreviewLimiter({
    onFrame() {},
  });

  assert.equal(limiter.intervalMs, 500);
});

test('limits serial JPEG preview rate and drops intermediate frames while keeping the latest', () => {
  const emitted = [];
  const limiter = new JpegPreviewLimiter({
    fps: 2,
    onFrame: frame => emitted.push(frame.toString()),
  });
  const jpeg = value => Buffer.from([0xff, 0xd8, value, 0xff, 0xd9]);

  assert.equal(limiter.push(jpeg(1), 0), true);
  assert.equal(limiter.push(jpeg(2), 100), false);
  assert.equal(limiter.push(jpeg(3), 200), false);
  assert.equal(limiter.flush(500), true);

  assert.deepEqual(emitted, [jpeg(1).toString(), jpeg(3).toString()]);
  assert.equal(limiter.droppedFrames, 1);
});

test('automatically flushes the latest pending preview frame when the rate limit expires', () => {
  const emitted = [];
  let now = 0;
  let scheduled = null;
  const limiter = new JpegPreviewLimiter({
    fps: 2,
    now: () => now,
    setTimer(callback, delay) {
      scheduled = {
        callback,
        delay,
        unref() {},
      };
      return scheduled;
    },
    clearTimer(timer) {
      if (scheduled === timer) scheduled = null;
    },
    onFrame: frame => emitted.push(frame[2]),
  });
  const jpeg = value => Buffer.from([0xff, 0xd8, value, 0xff, 0xd9]);

  assert.equal(limiter.push(jpeg(1)), true);
  assert.equal(limiter.push(jpeg(2)), false);
  assert.ok(scheduled);
  assert.equal(scheduled.delay, 500);
  const timer = scheduled;
  now = 500;
  timer.callback();

  assert.deepEqual(emitted, [1, 2]);
  assert.equal(limiter.pending, null);
});

test('drops an older pending preview when a newer frame can be sent immediately', () => {
  const emitted = [];
  const timers = [];
  const limiter = new JpegPreviewLimiter({
    fps: 2,
    setTimer(callback, delay) {
      const timer = {
        callback,
        delay,
        cancelled: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cancelled = true;
    },
    onFrame: frame => emitted.push(frame[2]),
  });
  const jpeg = value => Buffer.from([0xff, 0xd8, value, 0xff, 0xd9]);

  assert.equal(limiter.push(jpeg(1), 0), true);
  assert.equal(limiter.push(jpeg(2), 100), false);
  assert.equal(limiter.push(jpeg(3), 600), true);

  assert.deepEqual(emitted, [1, 3]);
  assert.equal(limiter.pending, null);
  assert.equal(timers[0].cancelled, true);
  assert.equal(limiter.flush(1200), false);
});

test('caps preview frames at 1 MiB and enforces a per-second byte budget', () => {
  const emitted = [];
  const limiter = new JpegPreviewLimiter({
    fps: 1000,
    maxFrameBytes: 1024 * 1024,
    bytesPerSecond: 16,
    onFrame: frame => emitted.push(frame),
  });
  const jpeg = payloadBytes => Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(payloadBytes, 1),
    Buffer.from([0xff, 0xd9]),
  ]);

  assert.equal(limiter.push(jpeg(4), 0), true);
  assert.equal(limiter.push(jpeg(4), 2), true);
  assert.equal(limiter.push(jpeg(4), 4), false);
  assert.equal(limiter.push(jpeg(1024 * 1024), 5), false);
  assert.equal(limiter.flush(1001), true);
  assert.equal(emitted.length, 3);
  assert.ok(limiter.droppedFrames >= 1);
});

test('keeps only the latest preview frame and drains control/terminal first', () => {
  const sent = [];
  const scheduler = new SerialFrameScheduler({
    send: frame => sent.push(frame),
  });

  scheduler.enqueuePreview('preview-1');
  scheduler.enqueuePreview('preview-2');
  scheduler.enqueueNormal('terminal');
  scheduler.enqueueNormal('control');
  scheduler.flush();

  assert.deepEqual(sent, ['terminal', 'control', 'preview-2']);
  assert.equal(scheduler.droppedPreviewFrames, 1);
});
