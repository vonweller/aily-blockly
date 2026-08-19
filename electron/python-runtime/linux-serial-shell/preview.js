'use strict';

const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_BYTES_PER_SECOND = 2 * 1024 * 1024;

function isJpeg(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return data.length >= 4
    && data[0] === 0xff
    && data[1] === 0xd8
    && data[data.length - 2] === 0xff
    && data[data.length - 1] === 0xd9;
}

class JpegPreviewLimiter {
  constructor({
    fps = 2,
    maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
    bytesPerSecond = DEFAULT_BYTES_PER_SECOND,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onFrame,
  } = {}) {
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('fps must be positive');
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 4 || maxFrameBytes > DEFAULT_MAX_FRAME_BYTES) {
      throw new RangeError(`maxFrameBytes must be between 4 and ${DEFAULT_MAX_FRAME_BYTES}`);
    }
    if (!Number.isInteger(bytesPerSecond) || bytesPerSecond < 1) {
      throw new RangeError('bytesPerSecond must be positive');
    }
    if (typeof onFrame !== 'function') throw new TypeError('onFrame function is required');
    this.intervalMs = 1000 / fps;
    this.maxFrameBytes = maxFrameBytes;
    this.bytesPerSecond = bytesPerSecond;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onFrame = onFrame;
    this.lastSentAt = null;
    this.windowStartedAt = null;
    this.windowBytes = 0;
    this.pending = null;
    this.pendingTimer = null;
    this.droppedFrames = 0;
  }

  push(frame, now = this.now()) {
    const data = Buffer.from(frame);
    if (!isJpeg(data)) throw new Error('preview frame is not a complete JPEG');
    if (data.length > this.maxFrameBytes || data.length > this.bytesPerSecond) {
      this.droppedFrames += 1;
      return false;
    }
    if (this.canSend(data.length, now)) {
      if (this.pending) {
        this.droppedFrames += 1;
        this.clearPending();
      }
      this.send(data, now);
      return true;
    }
    if (this.pending) this.droppedFrames += 1;
    this.pending = data;
    this.scheduleFlush(now);
    return false;
  }

  flush(now = this.now()) {
    if (!this.pending) return false;
    if (!this.canSend(this.pending.length, now)) {
      this.scheduleFlush(now);
      return false;
    }
    const frame = this.pending;
    this.pending = null;
    this.cancelPendingTimer();
    this.send(frame, now);
    return true;
  }

  scheduleFlush(now) {
    if (!this.pending || this.pendingTimer) return;
    const rateDelay = this.lastSentAt === null
      ? 0
      : Math.max(0, this.intervalMs - (now - this.lastSentAt));
    this.resetBudget(now);
    const budgetDelay = this.windowBytes + this.pending.length <= this.bytesPerSecond
      ? 0
      : Math.max(0, 1000 - (now - this.windowStartedAt));
    const delay = Math.max(1, Math.ceil(Math.max(rateDelay, budgetDelay)));
    this.pendingTimer = this.setTimer(() => {
      this.pendingTimer = null;
      this.flush(this.now());
    }, delay);
    this.pendingTimer?.unref?.();
  }

  cancelPendingTimer() {
    if (!this.pendingTimer) return;
    this.clearTimer(this.pendingTimer);
    this.pendingTimer = null;
  }

  clearPending() {
    this.pending = null;
    this.cancelPendingTimer();
  }

  reset(now = this.now()) {
    this.clearPending();
    this.lastSentAt = null;
    this.windowStartedAt = now;
    this.windowBytes = 0;
  }

  resetBudget(now) {
    if (this.windowStartedAt === null || now - this.windowStartedAt >= 1000 || now < this.windowStartedAt) {
      this.windowStartedAt = now;
      this.windowBytes = 0;
    }
  }

  canSend(length, now) {
    this.resetBudget(now);
    const rateReady = this.lastSentAt === null || now - this.lastSentAt >= this.intervalMs;
    return rateReady && this.windowBytes + length <= this.bytesPerSecond;
  }

  send(frame, now) {
    this.lastSentAt = now;
    this.windowBytes += frame.length;
    this.onFrame(frame);
  }
}

class SerialFrameScheduler {
  constructor({ send } = {}) {
    if (typeof send !== 'function') throw new TypeError('send function is required');
    this.send = send;
    this.highPriority = [];
    this.latestPreview = null;
    this.droppedPreviewFrames = 0;
  }

  enqueueNormal(frame) {
    this.highPriority.push(frame);
  }

  enqueuePreview(frame) {
    if (this.latestPreview !== null) this.droppedPreviewFrames += 1;
    this.latestPreview = frame;
  }

  flush() {
    while (this.highPriority.length > 0) {
      this.send(this.highPriority.shift());
    }
    if (this.latestPreview !== null) {
      const frame = this.latestPreview;
      this.latestPreview = null;
      this.send(frame);
    }
  }

  clearPreview() {
    this.latestPreview = null;
  }
}

module.exports = {
  DEFAULT_BYTES_PER_SECOND,
  DEFAULT_MAX_FRAME_BYTES,
  JpegPreviewLimiter,
  SerialFrameScheduler,
  isJpeg,
};
