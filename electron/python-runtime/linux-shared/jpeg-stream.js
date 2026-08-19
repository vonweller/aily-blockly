const { EventEmitter } = require('node:events');

const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);

class JpegStreamParser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxFrameBytes = Number.isInteger(options.maxFrameBytes) && options.maxFrameBytes > 0
      ? options.maxFrameBytes
      : 8 * 1024 * 1024;
    this.buffer = Buffer.alloc(0);
    this.droppedFrames = 0;
  }

  push(chunk) {
    if (!chunk || chunk.length === 0) return;
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    this.drain();
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  drain() {
    while (this.buffer.length > 0) {
      const start = this.buffer.indexOf(JPEG_START);
      if (start < 0) {
        this.buffer = this.buffer.subarray(this.buffer[this.buffer.length - 1] === 0xff ? this.buffer.length - 1 : this.buffer.length);
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);

      const end = this.buffer.indexOf(JPEG_END, JPEG_START.length);
      if (end < 0) {
        if (this.buffer.length > this.maxFrameBytes) {
          this.droppedFrames += 1;
          this.buffer = this.buffer.subarray(JPEG_START.length);
          continue;
        }
        return;
      }

      const frameEnd = end + JPEG_END.length;
      const frame = this.buffer.subarray(0, frameEnd);
      this.buffer = this.buffer.subarray(frameEnd);
      if (frame.length > this.maxFrameBytes) {
        this.droppedFrames += 1;
        continue;
      }
      this.emit('frame', Buffer.from(frame));
    }
  }
}

function createPreviewCommand(options = {}) {
  if (typeof options.command === 'string' && options.command.trim()) return options.command.trim();
  const width = Number.isInteger(options.width) ? options.width : 640;
  const height = Number.isInteger(options.height) ? options.height : 480;
  const fps = Number.isInteger(options.fps) ? options.fps : 15;
  const script = [
    'import cv2,sys,time',
    `cap=cv2.VideoCapture(${Number.isInteger(options.cameraId) ? options.cameraId : 0})`,
    `cap.set(cv2.CAP_PROP_FRAME_WIDTH,${width})`,
    `cap.set(cv2.CAP_PROP_FRAME_HEIGHT,${height})`,
    `cap.set(cv2.CAP_PROP_FPS,${fps})`,
    'interval=1.0/' + fps,
    'while True:',
    ' ok,frame=cap.read()',
    ' if not ok: time.sleep(interval); continue',
    " ok,data=cv2.imencode('.jpg',frame)",
    ' if ok: sys.stdout.buffer.write(data.tobytes()); sys.stdout.buffer.flush()',
    ' time.sleep(interval)',
  ].join(';');
  return `python3 -u -c ${JSON.stringify(script)}`;
}

module.exports = {
  JpegStreamParser,
  createPreviewCommand,
};
