'use strict';

const { normalizeMagic } = require('./protocol');
const { validateRemotePath } = require('./bootstrap');

function buildHelperSource({
  magic,
  helperPath = '/tmp/aily-serial-helper.py',
  sessionDirectory = '/tmp/aily-runtime/serial-session',
  maxFileSize = 32 * 1024 * 1024,
  previewBytesPerSecond = 2 * 1024 * 1024,
} = {}) {
  const protocolMagic = normalizeMagic(magic);
  const helper = validateRemotePath(helperPath);
  const session = validateRemotePath(sessionDirectory);
  if (!Number.isInteger(maxFileSize) || maxFileSize < 0 || maxFileSize > 32 * 1024 * 1024) {
    throw new RangeError('maxFileSize must be between 0 and 33554432');
  }
  if (!Number.isInteger(previewBytesPerSecond) || previewBytesPerSecond < 1) {
    throw new RangeError('previewBytesPerSecond must be positive');
  }

  const configuration = [
    `MAGIC = bytes.fromhex(${JSON.stringify(protocolMagic.toString('hex'))})`,
    `HELPER_PATH = ${JSON.stringify(helper)}`,
    `SESSION_DIRECTORY = ${JSON.stringify(session)}`,
    `MAX_FILE_SIZE = ${maxFileSize}`,
    `PREVIEW_BYTES_PER_SECOND = ${previewBytesPerSecond}`,
  ].join('\n');

  return `#!/usr/bin/env python3
import atexit
import base64
import collections
import fcntl
import hashlib
import importlib.util
import json
import os
import platform
import posixpath
import pty
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
import zlib

${configuration}
VERSION = 1
TYPE_CONTROL = 1
TYPE_TERMINAL = 2
TYPE_FILE = 3
TYPE_PREVIEW = 4
TYPE_ACK = 5
TYPE_ERROR = 6
TYPE_HEARTBEAT = 7
HEADER = struct.Struct(">16sBBHIII")
MAX_PAYLOAD = 16 * 1024 * 1024
MAX_PREVIEW_FRAME = 1024 * 1024
MAX_FILE_CHUNK = 48 * 1024

state_lock = threading.RLock()
queue_condition = threading.Condition()
high_priority = collections.deque()
latest_preview = None
next_sequence = 1
running = True
active_run = None
active_write = None
active_read = None
preview_process = None


def json_payload(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def queue_frame(frame_type, payload=b"", flags=0, sequence=None):
    global next_sequence
    if isinstance(payload, dict):
        payload = json_payload(payload)
    elif isinstance(payload, str):
        payload = payload.encode("utf-8")
    else:
        payload = bytes(payload)
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("payload exceeds protocol limit")
    with queue_condition:
        if sequence is None:
            sequence = next_sequence
            next_sequence = (next_sequence + 1) & 0xffffffff
        item = (frame_type, flags, sequence, payload)
        high_priority.append(item)
        queue_condition.notify_all()


def queue_preview_frame(process, payload):
    global latest_preview, next_sequence
    payload = bytes(payload)
    if len(payload) > MAX_PREVIEW_FRAME:
        return False
    with state_lock:
        if preview_process is not process:
            return False
        with queue_condition:
            sequence = next_sequence
            next_sequence = (next_sequence + 1) & 0xffffffff
            latest_preview = (TYPE_PREVIEW, 0, sequence, payload)
            queue_condition.notify_all()
    return True


def writer_loop():
    global latest_preview
    budget_started = time.monotonic()
    budget_bytes = 0
    while running or high_priority or latest_preview is not None:
        item = None
        with queue_condition:
            while running and not high_priority and latest_preview is None:
                queue_condition.wait(timeout=0.25)
            now = time.monotonic()
            if now - budget_started >= 1.0:
                budget_started = now
                budget_bytes = 0
            if high_priority:
                item = high_priority.popleft()
            elif latest_preview is not None:
                preview_size = len(latest_preview[3])
                if budget_bytes + preview_size <= PREVIEW_BYTES_PER_SECOND:
                    item = latest_preview
                    latest_preview = None
                    budget_bytes += preview_size
                else:
                    queue_condition.wait(timeout=max(0.01, 1.0 - (now - budget_started)))
                    continue
        if item is None:
            continue
        frame_type, flags, sequence, payload = item
        checksum = zlib.crc32(payload) & 0xffffffff
        header = HEADER.pack(MAGIC, VERSION, frame_type, flags, sequence, len(payload), checksum)
        try:
            sys.stdout.buffer.write(header)
            sys.stdout.buffer.write(payload)
            sys.stdout.buffer.flush()
        except (BrokenPipeError, OSError):
            request_shutdown()
            return


def send_reply(request, result=None, frame_type=TYPE_CONTROL):
    queue_frame(frame_type, {
        "replyTo": request.get("id"),
        "result": {} if result is None else result,
    })


def send_error(request, code, message):
    queue_frame(TYPE_ERROR, {
        "replyTo": request.get("id") if isinstance(request, dict) else None,
        "code": code,
        "message": str(message),
    })


def send_runtime_event(event, **values):
    payload = {"event": event}
    payload.update(values)
    queue_frame(TYPE_CONTROL, payload)


def validate_path(value):
    if not isinstance(value, str) or not value.startswith("/") or "\\x00" in value or "\\\\" in value:
        raise ValueError("path must be an absolute POSIX path")
    if ".." in value.split("/"):
        raise ValueError("path traversal is not allowed")
    normalized = posixpath.normpath(value)
    if normalized != value:
        raise ValueError("path must be normalized")
    return normalized


def proc_starttime(pid):
    with open("/proc/%d/stat" % pid, "r", encoding="utf-8") as stat_file:
        line = stat_file.read()
    fields = line[line.rfind(")") + 2:].split()
    return fields[19]


def terminate_process(process, pgid, grace=2.0):
    if process.poll() is not None:
        return
    grace = max(0.0, min(float(grace), 10.0))
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + grace
    while process.poll() is None and time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.05, remaining))
    if process.poll() is None:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def read_run_output(run):
    while True:
        try:
            data = os.read(run["master_fd"], 65536)
        except OSError:
            break
        if not data:
            break
        send_runtime_event(
            "output",
            runId=run["runId"],
            dataBase64=base64.b64encode(data).decode("ascii"),
        )


def wait_for_run(run):
    global active_run
    exit_code = run["process"].wait()
    try:
        os.close(run["master_fd"])
    except OSError:
        pass
    with state_lock:
        if active_run is run:
            active_run = None
    send_runtime_event("exited", runId=run["runId"], exitCode=exit_code)


def start_run(request):
    global active_run
    with state_lock:
        if active_run is not None and active_run["process"].poll() is None:
            raise RuntimeError("RUN_ALREADY_ACTIVE")
        script_path = validate_path(request["scriptPath"])
        run_id = str(request["runId"])
        token = str(request["token"])
        master_fd, slave_fd = pty.openpty()
        try:
            process = subprocess.Popen(
                ["python3", "-u", script_path],
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                start_new_session=True,
                close_fds=True,
            )
        finally:
            os.close(slave_fd)
        run = {
            "runId": run_id,
            "token": token,
            "pid": process.pid,
            "pgid": os.getpgid(process.pid),
            "starttime": proc_starttime(process.pid),
            "master_fd": master_fd,
            "process": process,
        }
        active_run = run
    result = {key: run[key] for key in ("runId", "token", "pid", "pgid", "starttime")}
    send_runtime_event("started", **result)
    threading.Thread(target=read_run_output, args=(run,), daemon=True).start()
    threading.Thread(target=wait_for_run, args=(run,), daemon=True).start()
    return result


def stop_run(request):
    global active_run
    with state_lock:
        run = active_run
    if run is None:
        return {"stopped": True, "running": False}
    if str(request.get("token")) != run["token"]:
        raise RuntimeError("run token mismatch")
    requested_starttime = str(request.get("starttime"))
    current_starttime = proc_starttime(run["pid"])
    if requested_starttime != run["starttime"] or current_starttime != run["starttime"]:
        raise RuntimeError("process starttime mismatch")
    terminate_process(run["process"], run["pgid"])
    return {"stopped": True, "runId": run["runId"]}


def write_terminal(payload):
    with state_lock:
        run = active_run
    if run is None or run["process"].poll() is not None:
        raise RuntimeError("no active run")
    os.write(run["master_fd"], payload)


def resize_terminal(request):
    columns = int(request["columns"])
    rows = int(request["rows"])
    if columns < 1 or columns > 1000 or rows < 1 or rows > 1000:
        raise ValueError("invalid terminal size")
    with state_lock:
        run = active_run
    if run is None:
        raise RuntimeError("no active run")
    size = struct.pack("HHHH", rows, columns, 0, 0)
    fcntl.ioctl(run["master_fd"], termios.TIOCSWINSZ, size)
    return {"columns": columns, "rows": rows}


def begin_write(request):
    global active_write
    if active_write is not None or active_read is not None:
        raise RuntimeError("another file transfer is active")
    path = validate_path(request["path"])
    size = int(request["size"])
    if size < 0 or size > MAX_FILE_SIZE:
        raise ValueError("file size exceeds limit")
    directory = posixpath.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=".aily-transfer-", dir=directory)
    active_write = {
        "path": path,
        "size": size,
        "sha256": str(request["sha256"]),
        "next_sequence": 0,
        "last_sequence": -1,
        "last_crc32": None,
        "written": 0,
        "temp_path": temp_path,
        "file": os.fdopen(fd, "wb"),
    }
    return {"ack": True}


def write_chunk(request):
    transfer = active_write
    if transfer is None:
        raise RuntimeError("no active write")
    sequence = int(request.get("sequence", request.get("index", -1)))
    data = base64.b64decode(request["dataBase64"], validate=True)
    if len(data) > MAX_FILE_CHUNK:
        raise ValueError("file chunk exceeds limit")
    checksum = zlib.crc32(data) & 0xffffffff
    if checksum != int(request["crc32"]):
        raise ValueError("file chunk CRC mismatch")
    if sequence == transfer["last_sequence"] and checksum == transfer["last_crc32"]:
        return {"ack": True, "sequence": sequence, "crc32": checksum}
    if sequence != transfer["next_sequence"]:
        raise ValueError("file chunk sequence mismatch")
    if transfer["written"] + len(data) > transfer["size"]:
        raise ValueError("file chunk exceeds declared size")
    transfer["file"].write(data)
    transfer["written"] += len(data)
    transfer["last_sequence"] = sequence
    transfer["last_crc32"] = checksum
    transfer["next_sequence"] += 1
    return {"ack": True, "sequence": sequence, "crc32": checksum}


def abort_write():
    global active_write
    transfer = active_write
    active_write = None
    if transfer is None:
        return
    try:
        transfer["file"].close()
    except Exception:
        pass
    try:
        os.unlink(transfer["temp_path"])
    except FileNotFoundError:
        pass


def commit_write(request):
    global active_write
    transfer = active_write
    if transfer is None:
        raise RuntimeError("no active write")
    expected = str(request["sha256"])
    try:
        transfer["file"].flush()
        os.fsync(transfer["file"].fileno())
        transfer["file"].close()
        if transfer["written"] != transfer["size"]:
            raise ValueError("file size mismatch")
        digest = hashlib.sha256()
        with open(transfer["temp_path"], "rb") as input_file:
            for block in iter(lambda: input_file.read(65536), b""):
                digest.update(block)
        actual = digest.hexdigest()
        if actual != expected or actual != transfer["sha256"]:
            raise ValueError("file SHA-256 mismatch")
        os.replace(transfer["temp_path"], transfer["path"])
        active_write = None
        return {"sha256": actual, "size": transfer["written"]}
    except Exception:
        abort_write()
        raise


def begin_read(request):
    global active_read
    if active_write is not None or active_read is not None:
        raise RuntimeError("another file transfer is active")
    path = validate_path(request["path"])
    size = os.path.getsize(path)
    if size > MAX_FILE_SIZE:
        raise ValueError("file size exceeds limit")
    digest = hashlib.sha256()
    with open(path, "rb") as input_file:
        for block in iter(lambda: input_file.read(65536), b""):
            digest.update(block)
    chunk_size = int(request.get("chunkSize", 32768))
    if chunk_size < 1 or chunk_size > MAX_FILE_CHUNK:
        raise ValueError("file chunk size exceeds limit")
    active_read = {
        "path": path,
        "size": size,
        "sha256": digest.hexdigest(),
        "chunk_size": chunk_size,
        "file": open(path, "rb"),
    }
    chunks = (size + chunk_size - 1) // chunk_size
    return {"size": size, "sha256": digest.hexdigest(), "chunks": chunks}


def read_chunk(request):
    transfer = active_read
    if transfer is None:
        raise RuntimeError("no active read")
    sequence = int(request.get("sequence", request.get("index", -1)))
    transfer["file"].seek(sequence * transfer["chunk_size"])
    data = transfer["file"].read(transfer["chunk_size"])
    return {
        "index": sequence,
        "sequence": sequence,
        "crc32": zlib.crc32(data) & 0xffffffff,
        "dataBase64": base64.b64encode(data).decode("ascii"),
    }


def finish_read():
    global active_read
    transfer = active_read
    active_read = None
    if transfer is not None:
        transfer["file"].close()


def stat_result(path):
    info = os.stat(path)
    return {
        "path": path,
        "size": info.st_size,
        "mtime": info.st_mtime,
        "type": "directory" if os.path.isdir(path) else "file",
    }


def atomic_write(path, data, mode=0o644):
    directory = posixpath.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".aily-", dir=directory)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def autostart_path(project):
    project = str(project)
    if not project or len(project) > 64 or any(
        character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
        for character in project
    ):
        raise ValueError("invalid autostart project")
    return "/boot/start/aily-%s.sh" % project


def detect_preview_backend():
    if shutil.which("rpicam-vid") or shutil.which("libcamera-vid"):
        return "rpicam"
    if os.path.exists("/dev/video0") and shutil.which("ffmpeg"):
        return "v4l2-ffmpeg"
    if importlib.util.find_spec("cv2") is not None:
        return "opencv"
    return None


def preview_value(value, default, minimum, maximum, label):
    if value is None:
        value = default
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise ValueError("%s must be an integer" % label)
    if value < minimum or value > maximum:
        raise ValueError("%s is outside the supported range" % label)
    return value


def preview_command(backend, width, height, fps):
    if backend == "rpicam":
        executable = shutil.which("rpicam-vid") or shutil.which("libcamera-vid")
        if executable is None:
            raise RuntimeError("PREVIEW_UNAVAILABLE")
        return [
            executable,
            "--nopreview",
            "--timeout", "0",
            "--width", str(width),
            "--height", str(height),
            "--framerate", str(fps),
            "--codec", "mjpeg",
            "--output", "-",
        ]
    if backend == "v4l2-ffmpeg":
        executable = shutil.which("ffmpeg")
        if executable is None or not os.path.exists("/dev/video0"):
            raise RuntimeError("PREVIEW_UNAVAILABLE")
        return [
            executable,
            "-hide_banner",
            "-loglevel", "error",
            "-f", "v4l2",
            "-framerate", str(fps),
            "-video_size", "%dx%d" % (width, height),
            "-i", "/dev/video0",
            "-an",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-",
        ]
    if backend == "opencv" and importlib.util.find_spec("cv2") is not None:
        source = """import cv2
import sys
camera = cv2.VideoCapture(0)
camera.set(cv2.CAP_PROP_FRAME_WIDTH, %d)
camera.set(cv2.CAP_PROP_FRAME_HEIGHT, %d)
camera.set(cv2.CAP_PROP_FPS, %d)
try:
    while camera.isOpened():
        ok, image = camera.read()
        if not ok:
            break
        ok, encoded = cv2.imencode(".jpg", image)
        if ok:
            sys.stdout.buffer.write(encoded.tobytes())
            sys.stdout.buffer.flush()
finally:
    camera.release()
""" % (width, height, fps)
        return [sys.executable, "-u", "-c", source]
    raise RuntimeError("PREVIEW_UNAVAILABLE")


def start_preview(request):
    global preview_process
    stop_preview()
    backend = detect_preview_backend()
    if backend is None:
        raise RuntimeError("PREVIEW_UNAVAILABLE")
    resolution = request.get("resolution") or {}
    if not isinstance(resolution, dict):
        raise ValueError("resolution must be an object")
    width = preview_value(resolution.get("w"), 320, 64, 1920, "preview width")
    height = preview_value(resolution.get("h"), 240, 64, 1080, "preview height")
    fps = preview_value(request.get("fps"), 2, 1, 30, "preview fps")
    command = preview_command(backend, width, height, fps)
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    preview_process = process
    threading.Thread(target=read_preview, args=(process,), daemon=True).start()
    return {
        "running": True,
        "backend": backend,
        "width": width,
        "height": height,
        "fps": fps,
        "pid": process.pid,
        "pgid": os.getpgid(process.pid),
    }


def read_preview(process):
    data = bytearray()
    while process.poll() is None:
        chunk = process.stdout.read(65536)
        if not chunk:
            break
        data.extend(chunk)
        while True:
            start = data.find(b"\\xff\\xd8")
            if start < 0:
                if len(data) > 1:
                    del data[:-1]
                break
            end = data.find(b"\\xff\\xd9", start + 2)
            if end < 0:
                if start > 0:
                    del data[:start]
                if len(data) > MAX_PREVIEW_FRAME:
                    del data[:2]
                break
            frame = bytes(data[start:end + 2])
            del data[:end + 2]
            if len(frame) <= MAX_PREVIEW_FRAME:
                queue_preview_frame(process, frame)


def stop_preview():
    global preview_process, latest_preview
    with state_lock:
        process = preview_process
        preview_process = None
        with queue_condition:
            latest_preview = None
            queue_condition.notify_all()
    if process is not None:
        try:
            terminate_process(process, os.getpgid(process.pid), grace=0.5)
        except ProcessLookupError:
            pass
    return {"running": False}


def capabilities():
    model = ""
    try:
        with open("/proc/device-tree/model", "rb") as model_file:
            model = model_file.read().decode("utf-8", "replace").lower()
    except OSError:
        pass
    if os.path.exists("/etc/walnutpi-release") or "walnut" in model:
        board_platform = "walnutpi"
    elif "raspberry pi" in model:
        board_platform = "raspberry-pi"
    else:
        board_platform = "linux"
    preview_backend = detect_preview_backend()
    preview_capabilities = {
        "available": preview_backend is not None,
        "transports": ["serial-framed"],
    }
    if preview_backend is not None:
        preview_capabilities["backend"] = preview_backend
    return {
        "platform": board_platform,
        "hostname": socket.gethostname(),
        "architecture": platform.machine(),
        "pythonVersion": platform.python_version(),
        "homeDirectory": os.path.expanduser("~"),
        "writableWorkspace": SESSION_DIRECTORY,
        "pty": True,
        "terminalResize": True,
        "processGroups": True,
        "files": "agent",
        "autostart": "boot-start-sh" if os.path.isdir("/boot/start") else "none",
        "preview": preview_capabilities,
    }


def handle_request(request):
    action = request.get("action")
    if action == "run":
        return start_run(request)
    if action == "stop":
        return stop_run(request)
    if action == "resize":
        return resize_terminal(request)
    if action == "file.write.begin":
        return begin_write(request)
    if action == "file.write.chunk":
        return write_chunk(request)
    if action == "file.write.commit":
        return commit_write(request)
    if action == "file.write.abort":
        abort_write()
        return {"aborted": True}
    if action == "file.read.begin":
        return begin_read(request)
    if action == "file.read.chunk":
        return read_chunk(request)
    if action == "file.read.ack":
        return {"ack": True}
    if action == "file.read.end":
        finish_read()
        return {"closed": True}
    if action == "file.list":
        path = validate_path(request["path"])
        return {"entries": [stat_result(posixpath.join(path, name)) for name in sorted(os.listdir(path))]}
    if action == "file.stat":
        return {"stat": stat_result(validate_path(request["path"]))}
    if action == "file.delete":
        os.unlink(validate_path(request["path"]))
        return {"deleted": True}
    if action == "file.rename":
        os.replace(validate_path(request["oldPath"]), validate_path(request["newPath"]))
        return {"renamed": True}
    if action == "file.mkdir":
        path = validate_path(request["path"])
        if request.get("recursive"):
            os.makedirs(path, exist_ok=True)
        else:
            os.mkdir(path)
        return {"created": True}
    if action == "file.rmdir":
        os.rmdir(validate_path(request["path"]))
        return {"removed": True}
    if action in ("autostart.install", "autostart.update"):
        target = autostart_path(request["project"])
        atomic_write(target, base64.b64decode(request["dataBase64"], validate=True), mode=0o755)
        return {"installed": True, "path": target}
    if action == "autostart.status":
        target = autostart_path(request["project"])
        return {"installed": os.path.isfile(target), "path": target}
    if action == "autostart.remove":
        target = autostart_path(request["project"])
        try:
            os.unlink(target)
        except FileNotFoundError:
            pass
        return {"removed": True, "path": target}
    if action == "preview.start":
        return start_preview(request)
    if action == "preview.stop":
        return stop_preview()
    if action == "capabilities":
        return capabilities()
    if action == "helper.shutdown":
        request_shutdown()
        return {"shutdown": True}
    raise ValueError("unsupported action: %s" % action)


def handle_frame(frame_type, sequence, payload):
    if frame_type == TYPE_TERMINAL:
        write_terminal(payload)
        return
    if frame_type not in (TYPE_CONTROL, TYPE_FILE):
        return
    request = json.loads(payload.decode("utf-8"))
    try:
        result = handle_request(request)
        response_type = TYPE_ACK if request.get("action") == "file.write.chunk" else TYPE_CONTROL
        send_reply(request, result, response_type)
    except PermissionError as error:
        send_error(request, "AUTOSTART_PERMISSION_DENIED", error)
    except RuntimeError as error:
        code = str(error)
        if code not in (
            "RUN_ALREADY_ACTIVE",
            "PREVIEW_UNAVAILABLE",
        ):
            code = "RUN_STOP_FAILED" if request.get("action") == "stop" else "RUNTIME_UNAVAILABLE"
        send_error(request, code, error)
    except Exception as error:
        code = "FILE_TRANSFER_FAILED" if str(request.get("action", "")).startswith("file.") else "RUNTIME_UNAVAILABLE"
        send_error(request, code, error)


def frame_loop():
    buffer = bytearray()
    while running:
        chunk = os.read(sys.stdin.fileno(), 65536)
        if not chunk:
            break
        buffer.extend(chunk)
        while buffer:
            magic_index = buffer.find(MAGIC)
            if magic_index < 0:
                if len(buffer) > len(MAGIC) - 1:
                    del buffer[:len(buffer) - len(MAGIC) + 1]
                break
            if magic_index:
                del buffer[:magic_index]
            if len(buffer) < HEADER.size:
                break
            magic, version, frame_type, flags, sequence, length, checksum = HEADER.unpack(buffer[:HEADER.size])
            if magic != MAGIC or version != VERSION or length > MAX_PAYLOAD:
                del buffer[0]
                continue
            frame_length = HEADER.size + length
            if len(buffer) < frame_length:
                break
            payload = bytes(buffer[HEADER.size:frame_length])
            if zlib.crc32(payload) & 0xffffffff != checksum:
                del buffer[0]
                continue
            del buffer[:frame_length]
            try:
                handle_frame(frame_type, sequence, payload)
            except Exception as error:
                send_error({}, "PROTOCOL_DESYNC", error)


def heartbeat_loop():
    while running:
        queue_frame(TYPE_HEARTBEAT, {"timestamp": time.time()})
        time.sleep(1.0)


def request_shutdown():
    global running
    running = False
    with queue_condition:
        queue_condition.notify_all()


def cleanup():
    global active_run
    stop_preview()
    finish_read()
    abort_write()
    with state_lock:
        run = active_run
        active_run = None
    if run is not None:
        terminate_process(run["process"], run["pgid"])
        try:
            os.close(run["master_fd"])
        except OSError:
            pass
    try:
        os.unlink(HELPER_PATH)
    except FileNotFoundError:
        pass
    shutil.rmtree(SESSION_DIRECTORY, ignore_errors=True)


def main():
    os.makedirs(SESSION_DIRECTORY, exist_ok=True)
    atexit.register(cleanup)
    threading.Thread(target=writer_loop, daemon=True).start()
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    queue_frame(TYPE_CONTROL, {"event": "ready", "capabilities": capabilities()})
    try:
        frame_loop()
    finally:
        request_shutdown()
        cleanup()


if __name__ == "__main__":
    main()
`;
}

module.exports = {
  buildHelperSource,
};
