# CyberCAM hardware smoke test

This checklist validates the Aily Blockly CyberCAM Python workflow on real hardware. Run it on a packaged build for the target host architecture. Use a known-good data USB cable, current CyberCAM firmware, a FAT-formatted writable `/data` volume, camera modules connected with power off, and a network with test MQTT and HTTP endpoints.

Record the app version, host OS/architecture, CyberCAM firmware commit, camera model/interface, display orientation, and the result of every numbered check. Never connect 5 V signals directly to 3.3 V GPIO.

## Automated coverage (no hardware)

The automated E2E test uses a protocol-compatible fake backend and a self-contained Python project. It verifies:

- canonical `devmode: "python"` and board runtime metadata (`canmv-k230`, `main.py`);
- Blockly generation and persistence of `main.py`;
- backend detect, connect, run, terminal output, preview frame, remote file list/read, stop, and disconnect;
- Electron shutdown disposal of the backend process;
- packaged-resource configuration and resolution for Windows x64/arm64, macOS x64/arm64, Linux x64/arm64, and `LICENSE.canmv-backend.txt`.

Run:

```powershell
npm run test:e2e:fast -- --grep "CyberCAM"
node --test electron/test/canmv-packaged-resources.test.js
npx tsc -p e2e/tsconfig.json --noEmit
```

The automated suite does not prove USB drivers, electrical IO, camera/display quality, model accuracy, Wi-Fi services, audio quality, IMU calibration, or cleanup on the physical board. Complete every hardware-only section below.

## Hardware-only setup and baseline

1. Power the CyberCAM off. Inspect camera/display flex cables, antenna, speaker/microphone, and expansion wiring. Remove external loads from GPIO52 (LED), GPIO21 (KEY), GPIO46 (fill light/PWM2), and GPIO47 (buzzer/PWM3).
2. Start the packaged Aily Blockly build. Create a Blockly project with board **CyberCAM** and verify the only product mode is **Python**. Open it and verify the Python Device panel is visible.
3. Connect USB. Click **Detect Python devices** and record the detected port, VID/PID, and board name. Connect and confirm the panel says **Connected** and the terminal accepts input.
4. Click **Disconnect**, unplug USB for five seconds, reconnect, detect again, and reconnect. Repeat while a preview is stopped and while a script is stopped. Pass if the same board returns without restarting the app and no stale port remains selected.
5. Unplug USB while connected. Pass if controls return to disconnected state, Run/Preview/files become unavailable, the Blockly workspace remains intact, and reconnect succeeds after replugging.

## LED, key, PWM, buzzer, and UART2

1. Run a GPIO script that configures onboard LED GPIO52 as output, alternates off/on every 500 ms ten times, then leaves it off. Pass if the LED follows exactly and Stop interrupts the loop.
2. Configure KEY GPIO21 as input with the board library's documented pull setting. Print transitions with timestamps while pressing and releasing ten times. Pass if every press/release is observed once after expected debounce and idle state is stable.
3. Drive fill light GPIO46/PWM2 at 0%, 25%, 50%, 75%, and 100% duty for two seconds each, then 0%. Pass if brightness increases monotonically without flicker or residual illumination.
4. Drive buzzer GPIO47/PWM3 at three audible frequencies and two duty levels for one second each, then deinitialize PWM. Pass if pitch changes, output stops completely, and the fill light does not react.
5. Cross-connect UART2 TX GPIO11 to UART2 RX GPIO12 through the required 3.3 V wiring. Send UTF-8 text and a binary byte sequence at 115200 baud and read both back. Repeat with an external 3.3 V UART adapter. Pass if bytes, ordering, and baud rate are correct and Stop closes UART cleanly.

## Cameras, display, rotation, and IDE preview

1. With power off, install the supported CSI2 camera. Boot, initialize the documented sensor/resolution/pixel format, capture 100 frames, and display frame dimensions/fps. Pass if there are no frame errors, color corruption, or leaked camera handles after release/reinitialize.
2. Repeat with the supported CSI0 camera/interface. If both interfaces can be present, select each explicitly and prove frames come from the selected sensor.
3. Initialize the onboard display, clear/fill with red, green, blue, black, and white, then draw text, pixel, line, rectangle, circle, and an image. Pass if geometry, colors, clipping, and refresh are correct.
4. Set display rotation to each supported value (0/90/180/270 or the documented equivalents). For each rotation, show labeled corners and a captured frame. Pass if orientation, dimensions, and touch/display direction agree.
5. Start **Preview** in Aily Blockly/IDE, move a high-contrast object through the frame, and verify live updates. Stop/restart preview three times, then run/stop a camera script. Pass if frames remain current, no duplicate stream persists, and the physical display and IDE preview can be released and reacquired.

## OpenCV and classical vision

Use fixed printed targets under stable lighting and save representative input/output images under `/data/smoke/`.

1. Verify resize, color conversion, thresholding, edge detection, line/rectangle/circle/polyline/text drawing, and color-region detection. Record input/output dimensions and detected coordinates.
2. Decode at least two QR codes (ASCII and UTF-8), two 1D barcodes, and one supported 2D barcode if distinct from QR. Pass if payloads match exactly and no false result appears on a blank target.
3. Detect AprilTags using every family exposed by the CyberCAM blocks (including the default `tag36h11`). Record ID, family, center, corners, and pose fields where supported. Pass if the correct printed tag is returned and an unsupported/blank target is empty.

## KPU: all 14 classes/families

Copy known-good, firmware-compatible model files and auxiliary assets to `/data/models/`. For each item below: initialize from `/data`, run at least ten positive and ten negative frames, print result count/label/confidence/box or keypoints, draw the result on display and IDE preview, stop, release, and initialize the next class. Never treat this smoke test as an accuracy benchmark; pass means correct lifecycle, result shape, and plausible positive/negative behavior.

1. `FACE_DETECT` — face box and confidence.
2. `FACE_MASK` — masked/unmasked classification tied to a detected face.
3. `FALL_DETECT` — fall/non-fall result.
4. `HAND_DETECT` — hand box and confidence.
5. `HAND_KEYPOINT` — hand landmarks.
6. `HAND_KEYPOINT_CLS` — documented hand/gesture class.
7. `LICENCE_DETECT` — plate region and recognition result with anchors/labels.
8. `OCR` — detected text and recognized UTF-8 result using the supplied dictionary.
9. `PERSON_DETECT` — person box and confidence.
10. `PERSON_KEYPOINT` — person landmarks/skeleton.
11. `SMOKE_DETECT` — smoke/non-smoke result.
12. `TRAFFIC_LIGHT_DETECT` — light box/state.
13. `YOLO11_CLS` — expected class label and confidence from a custom classification model.
14. `YOLO11_DET` — expected boxes/labels/confidence from a custom detection model.

Pass the family only if model initialization errors are surfaced without crashing, inference results can be iterated with the documented fields, Stop returns promptly, and the next model can allocate successfully. Record model filenames, sizes, hashes, thresholds, and firmware version for reproducibility.

## `/data` files and remote file panel

1. Create `/data/smoke/`, write UTF-8 text and a binary file, close, reopen, verify exact content/hash, rename, list, and delete each file. Attempt a missing file and invalid path and verify a visible error without affecting other files.
2. Refresh the Aily Blockly Device file tree. Open a Python file, edit and save it, refresh, reopen, and verify exact content. Create/rename/delete a directory and execute a selected `.py` file. Pass if operations affect `/data` only and local project `main.py` remains unchanged.
3. Fill available test space gradually, verify a clear out-of-space error, then remove smoke data. Do not fill the firmware/system partition.

## Socket, MQTT, and HTTP

1. Join the test Wi-Fi, print assigned IP/DNS/gateway, disconnect, and reconnect. Pass if network loss is reported and services recover without reboot.
2. TCP: connect to a test echo server, send/receive UTF-8 and binary payloads, close, then repeat. UDP: send/receive a datagram and verify source address. Also bind/listen/accept one inbound TCP connection if firewall policy permits.
3. MQTT: connect with a unique client ID, subscribe to a unique topic, publish QoS/configurations supported by the blocks, receive the exact payload, run the loop, disconnect, and reconnect. Verify broker-unavailable and wrong-credential errors are visible.
4. HTTP client: GET a known JSON response and POST a known payload, verify status/body/headers, and exercise timeout/non-2xx handling. HTTP server: serve on a test port, fetch it from another host, then Stop and verify the port closes.

## Audio and QMI8658 IMU

1. Record five seconds from each exposed microphone/channel to `/data/smoke/audio`, close the recording, play it through the speaker, and verify duration, channel selection, intelligibility, and no clipping at a safe volume.
2. Play a known WAV/PCM asset, Stop halfway, replay fully, then release audio. Pass if no stale audio process/device remains and camera/KPU still starts afterward.
3. Initialize QMI8658 on onboard I2C1 (SCL40/SDA41). With the board stationary, print timestamped accelerometer and gyroscope axes; rotate each physical axis and verify sign/dominant-axis changes. Run calibration with the documented sample count and verify stable stationary values.
4. Stop/reinitialize the IMU three times and verify I2C errors are visible if the sensor is deliberately unavailable (only when safe to simulate).

## Terminal, Run/Stop, reconnect, and shutdown cleanup

1. Run generated `main.py`; verify terminal stdout ordering and UTF-8. Send terminal input to an interactive script and resize the panel/window. Pass if input is received once and output remains readable.
2. Start a long loop using camera, preview, a file, network socket, audio, and IMU as applicable. Click **Stop**. Pass if the UI returns to Run promptly and all resources can immediately be reopened.
3. Run again, then disconnect. Reconnect and run a small print script. Pass if there is no stale running state or duplicate terminal output.
4. Start preview and a long script, then quit Aily Blockly normally. Verify in the OS process list that `canmv-backend` exits, serial/USB handles close, and no app-owned Python/backend process remains. Reopen the app and reconnect without power-cycling the board.
5. Repeat normal quit while disconnected and after a physical USB unplug. Pass if shutdown does not hang, report an unhandled rejection, leave a locked `/data` file, or require force termination.

The hardware smoke test is complete only when all applicable checks pass or each failure has a recorded issue containing logs, generated `main.py`, firmware/model versions, exact reproduction steps, and captured terminal/frame evidence.
