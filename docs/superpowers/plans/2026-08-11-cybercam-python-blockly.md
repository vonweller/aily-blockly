# CyberCam Python Blockly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver CyberCam as a Python-only board in the normal Blockly workflow, with a complete CyberCam block library and an embedded CanMV runtime ready for hardware testing.

**Architecture:** The board package declares canonical `python` mode and the `canmv-k230` adapter. The app maps Python to its existing MicroPython generator internally, loads board/library generators in the isolated Blockly realm, and routes generic device operations to an Electron-hosted backend. The CyberCam library owns hardware blocks and Python code generation; application behavior never branches on the CyberCam board name.

**Tech Stack:** Angular 19, TypeScript, Blockly, Electron/CommonJS, Node test runner, Jasmine/Karma, JSON board packages, JavaScript generators, official 01Studio CyberCAM Wiki/Apps and VSCode 1.1.0 backend.

---

## Working locations

- Main app: `D:/Do/Githubs/Aily/aily-blockly-python-runtime`
- Boards: `D:/Do/Githubs/Aily/aily-blockly-boards`
- Libraries: `D:/Do/Githubs/Aily/aily-blockly-libraries`
- Official Wiki: `%TEMP%/codex-cybercam-reference/01studio_wiki/docs/cybercam`
- Official Apps: `%TEMP%/codex-cybercam-reference/CyberCAM-Apps`
- Official VSIX: `%TEMP%/codex-cybercam-reference/cybercam-vscode-1.1.0/extension`

### Task 1: Rebase the runtime foundation onto current main

**Files:** Resolve `electron/main.js`, `src/app/editors/code-editor/code-editor.component.ts`, both project-new implementations, and `src/app/services/project.service.ts`; preserve `electron/python-runtime/**`, `src/app/services/python-runtime/**`, and `docs/superpowers/**`.

- [ ] **Step 1: Rebase and expose conflicts**

Run `git fetch origin` and `git rebase origin/main`. Expected: conflicts where the old foundation hardcoded a Python project type or current main added cleanup/project-creation behavior.

- [ ] **Step 2: Keep only generic runtime changes**

Keep current-main imports and cleanup handlers, add CanMV registration/disposal, and remove `projectType`, `CYBERCAM_K230_PYTHON_BOARD`, `selectProjectType()`, and `isEmbeddedPythonProjectRequest()`.

Run:

```powershell
rg -n "CYBERCAM_K230_PYTHON_BOARD|selectProjectType|projectType.*python|isEmbeddedPythonProjectRequest" src electron
```

Expected: no matches.

- [ ] **Step 3: Finish and verify the rebase**

Run `git add` for the seven conflicts, `git rebase --continue`, and `git status --short --branch`. Expected: branch based on `origin/main`; only local `.learnings/` remains untracked.

- [ ] **Step 4: Run the inherited backend tests**

```powershell
node --test electron/test/canmv-protocol.test.js electron/test/canmv-backend.test.js electron/test/canmv-runtime-path.test.js electron/test/canmv-ipc.test.js
```

Expected: all pass.

### Task 2: Add canonical Python mode and runtime metadata

**Files:** Create `src/app/services/python-runtime/python-mode.ts` and `.spec.ts`; modify the generator runtime, Blockly component, both project-new components, and `src/app/types/project-new.ts`.

- [ ] **Step 1: Write the failing normalization tests**

```ts
expect(normalizeBlocklyGeneratorMode('python')).toBe('micropython');
expect(normalizeBlocklyGeneratorMode('micropython')).toBe('micropython');
expect(normalizeBlocklyGeneratorMode('arduino')).toBe('arduino');
expect(readPythonRuntimeMetadata({
  runtime: { kind: 'python', adapter: 'canmv-k230', entry: 'main.py' },
})).toEqual({ kind: 'python', adapter: 'canmv-k230', entry: 'main.py' });
```

- [ ] **Step 2: Confirm failure**

Run `npx ng test --watch=false --browsers=ChromeHeadless --include src/app/services/python-runtime/python-mode.spec.ts`. Expected: missing module failure.

- [ ] **Step 3: Implement the boundary**

```ts
export type InternalGeneratorMode = 'arduino' | 'micropython';
export interface PythonRuntimeMetadata { kind: 'python'; adapter: string; entry: string; }

export function normalizeBlocklyGeneratorMode(mode: unknown): InternalGeneratorMode {
  return mode === 'python' || mode === 'micropython' ? 'micropython' : 'arduino';
}

export function readPythonRuntimeMetadata(board: any): PythonRuntimeMetadata | null {
  const runtime = board?.runtime;
  if (runtime?.kind !== 'python' || typeof runtime.adapter !== 'string') return null;
  return { kind: 'python', adapter: runtime.adapter, entry: runtime.entry || 'main.py' };
}
```

Expose `Python` in the isolated generator realm and retain `MPY` and `MicropPython` aliases.

- [ ] **Step 4: Restore the board-mode control**

Render modes from `currentBoard.mode`. Display `Python` for `python` and legacy `micropython`. A one-mode board shows a disabled selected control; a multi-mode board shows selectable controls. No mode code may insert or identify a board.

- [ ] **Step 5: Test and commit**

Run the mode and generator-runtime specs, then commit as `feat: add board-driven Python project mode`.

### Task 3: Add the CyberCam board package

**Files:** Create `cybercam/{package.json,board.json,board.webp,menu.json,readme.md}`, eleven `i18n/*.json` files, and `cybercam/template/{package.json,project.abi}` in the boards repository.

- [ ] **Step 1: Create branch `codex/cybercam-python-board` and an initially failing package**

Use this identity:

```json
{
  "name": "@aily-project/board-cybercam",
  "version": "1.1.0",
  "nickname": "CyberCAM",
  "brand": "01Studio"
}
```

Run the repository compliance check and confirm it rejects missing template/board metadata.

- [ ] **Step 2: Implement board capabilities**

```json
{
  "mode": ["python"],
  "runtime": { "kind": "python", "adapter": "canmv-k230", "entry": "main.py" },
  "digitalPins": [["GPIO11", "11"], ["GPIO12", "12"], ["GPIO14", "14"], ["GPIO15", "15"], ["GPIO16", "16"], ["GPIO17", "17"], ["LED", "52"], ["KEY", "21"], ["Fill light", "46"], ["Buzzer", "47"]],
  "pwmPins": [["PWM0", "60"], ["PWM1", "61"], ["Fill light PWM2", "46"], ["Buzzer PWM3", "47"]],
  "uartPorts": [["UART2 TX11/RX12", "2"]],
  "i2cPorts": [["I2C2 SCL11/SDA12", "2"], ["IMU I2C1 SCL40/SDA41", "1"]],
  "spiPorts": [["SPI0 CS14/SCLK15/MOSI16/MISO17", "0"]]
}
```

- [ ] **Step 3: Add a compliant template**

The template records `devmode: "python"`, exactly one `@aily-project/board-cybercam: 1.1.0` dependency, `@aily-project/lib-cybercam: 1.0.0`, and core logic/loop/math/text/variables libraries. `project.abi` contains CyberCam start and forever blocks.

- [ ] **Step 4: Validate and commit**

Run the board compliance workflow locally; expected zero CyberCam errors. Commit as `feat: add CyberCam Python board package`.

### Task 4: Emit generated Python to `main.py`

**Files:** Create `src/app/editors/blockly-editor/services/python-generated-artifacts.ts` and `.spec.ts`; modify builder, uploader, and editor project services.

- [ ] **Step 1: Write a failing artifact test**

```ts
await writePythonGeneratedArtifact('D:/project', 'main.py', 'print("ok")', io);
expect(io.writes).toEqual([['D:/project/main.py', 'print("ok")\n']]);
```

- [ ] **Step 2: Implement the writer**

```ts
export async function writePythonGeneratedArtifact(
  root: string,
  entry: string,
  code: string,
  io: { join: (...p: string[]) => string; writeText: (p: string, t: string) => Promise<void> },
): Promise<string> {
  const target = io.join(root, entry || 'main.py');
  await io.writeText(target, code.endsWith('\n') ? code : `${code}\n`);
  return target;
}
```

- [ ] **Step 3: Route generation by mode**

Python calls `workspaceToCode()`, publishes code unchanged, writes the runtime entry, and sends source to the adapter. It never calls Arduino normalization, artifact writing, preprocess, compile, or uploader paths. Arduino behavior is unchanged.

- [ ] **Step 4: Test and commit**

Run focused artifact/builder/uploader specs and commit as `feat: emit Blockly Python projects to main.py`.

### Task 5: Harden the CanMV backend and register a generic adapter

**Files:** Modify `electron/python-runtime/**`, `electron/{main,preload}.js`, `src/app/types/electron.d.ts`; create `python-runtime-adapter.ts`, `python-runtime-registry.ts`, `canmv-k230-runtime.adapter.ts`, and matching specs.

- [ ] **Step 1: Add failing lifecycle and registry tests**

Cover lazy process start, shared concurrent start, request timeout, rejection on unexpected exit, idempotent disposal, unsupported adapters, and metadata-based resolution:

```ts
expect(registry.resolve({ kind: 'python', adapter: 'canmv-k230', entry: 'main.py' }))
  .toBe(canmvAdapter);
expect(() => registry.resolve({ kind: 'python', adapter: 'missing', entry: 'main.py' }))
  .toThrowError(/Unsupported Python runtime adapter: missing/);
```

- [ ] **Step 2: Match the official VSIX 1.1.0 method contract**

Implement detection, connect/disconnect, run/stop/status, terminal input/resize, preview start/stop, list/stat/read/write/delete/rename/mkdir/rmdir/exec, firmware commit, virtual touch, and state/stderr/frame events. Preserve `LICENSE.canmv-backend.txt` beside packaged binaries.

- [ ] **Step 3: Verify both process and renderer boundaries**

Run `node --test electron/test/canmv-*.test.js` and the Python runtime Angular specs. Expected: all pass and read-only application startup tests do not launch a backend.

- [ ] **Step 4: Commit**

Commit as `feat: register the CanMV Python runtime adapter`.

### Task 6: Integrate Python device controls into Blockly

**Files:** Adapt the existing Python device panel, terminal, preview, and remote-tree components into `src/app/editors/blockly-editor/components/python-runtime-panel/**`; modify Blockly editor TS/HTML/SCSS; remove code-editor-only Python wiring.

- [ ] **Step 1: Write component tests**

Assert hidden for Arduino, visible for `canmv-k230`, run disabled before connection, stop shown while running, disconnect preserves the workspace, and event listeners are removed on destroy.

- [ ] **Step 2: Build a generic panel API**

The panel receives adapter state and emits connect, disconnect, run, stop, terminal input, refresh, and file actions. It must not inspect a board name or call `window.electronAPI.pythonRuntime` directly.

- [ ] **Step 3: Reuse validated models**

Retain base64 file transfer, sorted tree construction, preview object-URL cleanup, terminal resize, loading/error/empty states, and reconnect handling.

- [ ] **Step 4: Test and commit**

Run panel and runtime-adapter specs. Commit as `feat: add Python device controls to Blockly`.

### Task 7: Create CyberCam core and IO blocks

**Files:** Create `cybercam/{package.json,block.json,toolbox.json,generator.js}` and `cybercam/test/generator.test.cjs` in the libraries repository.

- [ ] **Step 1: Create branch `codex/cybercam-python-blocks` and a generator harness**

The harness evaluates `generator.js` with fake `Python.forBlock`, block fields, inputs, name database, and code dictionaries.

- [ ] **Step 2: Add stable core and IO types**

```text
cybercam_start, cybercam_forever, cybercam_sleep, cybercam_print,
cybercam_gpio_create, cybercam_gpio_direction, cybercam_gpio_pull,
cybercam_gpio_write, cybercam_gpio_read, cybercam_led, cybercam_key_pressed,
cybercam_pwm_create, cybercam_pwm_set,
cybercam_uart_create, cybercam_uart_write, cybercam_uart_read,
cybercam_file_open, cybercam_file_write, cybercam_file_read,
cybercam_file_close, cybercam_run_command
```

Use the official `board`, `digitalio`, PWM, serial, `time`, `subprocess`, and file examples; source pin menus from board metadata.

- [ ] **Step 3: Test and commit**

Run `node cybercam/test/generator.test.cjs`, `npm run validate:changed`, `npm run readme:check`, and `npm run i18n:check`. Commit as `feat: add CyberCam Python core and IO blocks`.

### Task 8: Add camera, display, drawing, and classical vision blocks

**Files:** Modify the four CyberCam library runtime files and generator tests.

- [ ] **Step 1: Add failing golden tests**

Cover `Sensor.Sensor(width,height,id)`, `isOpened`, `read`, `release`, mirror/flip, `Display.init/set_rotation/show`, `IDE.show`, and `direction.get_lcd`.

- [ ] **Step 2: Implement camera/display blocks**

```text
cybercam_camera_create, cybercam_camera_opened, cybercam_camera_read,
cybercam_camera_release, cybercam_camera_hmirror, cybercam_camera_vflip,
cybercam_display_init, cybercam_display_rotation, cybercam_display_show,
cybercam_ide_show, cybercam_display_direction
```

- [ ] **Step 3: Implement OpenCV and classical vision blocks**

```text
cybercam_cv_line, cybercam_cv_rectangle, cybercam_cv_circle,
cybercam_cv_polyline, cybercam_cv_text, cybercam_cv_resize,
cybercam_cv_color_convert, cybercam_cv_threshold,
cybercam_cv_find_edges, cybercam_cv_find_circles, cybercam_cv_find_rectangles,
cybercam_cv_decode_barcode, cybercam_cv_decode_qrcode,
cybercam_cv_decode_apriltag, cybercam_cv_find_color_regions
```

Argument order and constants come from the official Wiki examples.

- [ ] **Step 4: Test and commit**

Run generator and compliance checks. Commit as `feat: add CyberCam camera and vision blocks`.

### Task 9: Add complete KPU/AI blocks

**Files:** Modify CyberCam block/toolbox/generator/test files.

- [ ] **Step 1: Write constructor and result-shape tests**

Cover `FACE_DETECT`, `PERSON_DETECT`, `PERSON_KEYPOINT`, `FALL_DETECT`, `HAND_DETECT`, `HAND_KEYPOINT`, `HAND_KEYPOINT_CLS`, `FACE_MASK`, `LICENCE_DETECT`, `OCR`, `YOLO11_DET`, and `YOLO11_CLS` using official Apps code.

- [ ] **Step 2: Implement lifecycle and inference blocks**

Provide model path/size, image, confidence, and NMS inputs; output result list/count/index plus label, confidence, bounding-box, and keypoint accessors. Model binaries remain external and are never committed to the library.

- [ ] **Step 3: Add exact golden generation tests**

Assert constructor syntax, `.run(image, confidence, nms)`, safe model-path quoting, and generator-managed variable names for every class.

- [ ] **Step 4: Test and commit**

Run generator and compliance checks. Commit as `feat: add CyberCam KPU AI blocks`.

### Task 10: Complete networking, storage, audio, IMU, and expansion blocks

**Files:** Modify CyberCam library files and tests.

- [ ] **Step 1: Add failing tests from official remaining lessons**

Cover TCP/UDP sockets, MQTT connect/publish/subscribe/loop/disconnect, HTTP GET/POST/server, `/sdcard`, audio record/play, CPU temperature, chip ID, display direction/touch, QMI8658 IMU, and relay output.

- [ ] **Step 2: Implement each resource lifecycle**

Every owned resource receives create/open, use, status/error, and close/release blocks. Network callback blocks generate named Python functions before registration. Only APIs present in the official Wiki or Apps may be emitted.

- [ ] **Step 3: Test and commit**

Run generator, validation, readme, and i18n checks. Commit as `feat: complete CyberCam peripheral blocks`.

### Task 11: Localize and document every public block

**Files:** Create eleven `cybercam/i18n/*.json` files plus `readme.md`, `readme_ai.md`, and `API-COVERAGE.md`.

- [ ] **Step 1: Add complete localized keys**

Every stable block has a label, field labels, tooltip, and help text in `zh_cn`, `zh_hk`, `en`, `ja`, `ko`, `de`, `fr`, `es`, `pt`, `ru`, and `ar`.

- [ ] **Step 2: Write AI-readable contracts**

For each block, document its type, input names/types, generated Python, output shape, required initialization, and official source page.

- [ ] **Step 3: Build the API coverage matrix**

Map every current official CyberCAM Wiki lesson to block types or an explicit exclusion reason limited to deployment-only UI, unsafe system administration, or unavailable hardware accessories.

- [ ] **Step 4: Validate and commit**

Run all library validation/readme/i18n commands. Commit as `docs: document the CyberCam block library`.

### Task 12: Add E2E and packaged-resource verification

**Files:** Create `e2e/tests/cybercam-python-project.spec.ts`, `e2e/fixtures/projects/cybercam-python/**`, and `docs/cybercam-hardware-smoke-test.md`; modify main `package.json` resource configuration.

- [ ] **Step 1: Add a fake-backend E2E path**

Launch with `CANMV_BACKEND_PATH` pointing to a fixture protocol peer. Create a CyberCam project, verify Python mode, place camera/AI/IO blocks, assert `main.py`, connect, run, receive output/frame, browse files, stop, and disconnect.

- [ ] **Step 2: Verify packaged resources**

Assert all six platform/architecture backend binaries and `LICENSE.canmv-backend.txt` are copied under `python-runtime`, and `resolveCanmvBackendExecutable()` finds them.

- [ ] **Step 3: Write the hardware checklist**

Cover USB detection/reconnect, LED/key, PWM fill light, UART2, CSI2/CSI0 camera, display rotation, IDE preview, drawing, classical vision, each KPU family, `/sdcard`, MQTT/HTTP/socket, audio, IMU, terminal, remote files, run/stop, and shutdown cleanup.

- [ ] **Step 4: Run full automated verification**

```powershell
node --test electron/test/canmv-*.test.js
npx ng test --watch=false --browsers=ChromeHeadless --include src/app/services/python-runtime/*.spec.ts --include src/app/editors/blockly-editor/**/*.spec.ts
npm run test:e2e:fast -- --grep "CyberCam"
```

In libraries run:

```powershell
node cybercam/test/generator.test.cjs
npm run validate:changed
npm run readme:check
npm run i18n:check
```

Run the board compliance workflow locally. Expected: all commands pass.

- [ ] **Step 5: Commit**

Commit as `test: cover the CyberCam Python workflow`.

### Task 13: Final cross-repository review and handoff

**Files:** All changed files in all three repositories.

- [ ] **Step 1: Prove application behavior is board-agnostic**

```powershell
rg -n "CyberCAM|cybercam" src electron | rg -v "test|spec|adapter|license|docs"
```

Expected: no project-creation/editor branch on a board name; matches are adapter registration, resources, tests, and docs.

- [ ] **Step 2: Audit coverage against official sources**

Compare `API-COVERAGE.md` with the current official Wiki directory and CyberCAM Apps classes. Every supported lesson maps to blocks and golden tests.

- [ ] **Step 3: Run final repository checks**

Run `git diff --check` and `git status --short --branch` in all three repositories. Expected: no unstaged implementation changes; local `.learnings/` may remain untracked.

- [ ] **Step 4: Deliver for device testing**

Provide three branch names and commit heads, automated results, known hardware-only checks, the exact app launch command, and `docs/cybercam-hardware-smoke-test.md`.
