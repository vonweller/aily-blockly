# CyberCam Python Blockly Integration Design

## Goal

Integrate CyberCam as a Python-only board in the shared Aily Blockly board workflow and deliver a complete board-specific Blockly library for camera, display, AI, IO, communications, storage, and device execution.

CyberCam is not a separate project type. A user selects the board first, sees Python as its only supported development mode, creates a normal Blockly project, generates Python code from blocks, and runs that code through the embedded CanMV backend.

## Product Decisions

- The product term and persisted project mode are `Python` / `python`.
- CyberCam supports Python only.
- The project opens in the existing Blockly editor, not the standalone code editor.
- The first release includes the complete CyberCam hardware block set rather than a runtime-only foundation.
- Existing projects with `devmode: "micropython"` remain compatible.
- CanMV and MicroPython remain implementation details; they are not shown as the CyberCam product mode.

## Architecture

### Board-driven mode and runtime metadata

The CyberCam board package in `aily-blockly-boards` is the source of truth for capability selection. Its board metadata declares:

```json
{
  "mode": ["python"],
  "runtime": {
    "kind": "python",
    "adapter": "canmv-k230",
    "entry": "main.py"
  }
}
```

The main app consumes these fields generically. It must not compare a board name to `CyberCam` or inject a synthetic CyberCam board from application code.

The project package records `devmode: "python"`. A small normalization boundary maps both `python` and legacy `micropython` projects to the existing `MicroPythonGenerator` until the generator class can be renamed independently. Runtime behavior is selected from board metadata, not from project type conditionals.

### Project creation flow

The existing sequence remains:

1. Select a board.
2. Select one of the modes declared by that board.
3. Configure project name, location, version, and template.
4. Create and open the Blockly project.

For CyberCam, the mode control displays a single read-only Python choice. Boards with multiple modes continue to receive a selectable mode control. The old commented mode selector is replaced by a typed, data-driven implementation with product labels supplied through i18n.

Project creation always installs and copies the selected board package template. There is no direct starter-project writer in the main application. The CyberCam template owns its initial `package.json`, `project.abi`, `main.py` conventions, and default CyberCam library dependency.

### Blockly generator compatibility

The Blockly generator runtime accepts the canonical modes `arduino`, `python`, and legacy `micropython`. `python` and `micropython` both instantiate the current `MicroPythonGenerator`.

The isolated generator realm exposes a canonical `Python` generator global and retains `MPY` and `MicropPython` as compatibility aliases. New CyberCam generators register handlers through `Python.forBlock`; older MicroPython libraries continue to load unchanged.

Generated Python is published through the existing Blockly generated-code pipeline. Arduino-only normalization and artifact writers are bypassed for Python projects. Python output is written to the board runtime entry file, normally `main.py`.

### Embedded CanMV runtime

The embedded `canmv-backend` remains an Electron main-process service with a narrow preload bridge. Its protocol supports board detection, connect/disconnect, script run/stop, terminal input and resize, preview frames, remote file operations, firmware commit, and virtual touch.

The renderer selects this service through a runtime adapter registry keyed by `canmv-k230`. The adapter presents generic Python device operations to the Blockly editor. The editor does not call CyberCam-specific IPC channels directly.

The runtime panel is integrated into the Blockly editor and contains:

- connection and detected-device state;
- run and stop controls for generated Python;
- terminal output and input;
- live camera preview;
- remote board file tree and file operations;
- explicit, recoverable error states.

The service starts lazily on first use and is disposed during application shutdown. Packaged binaries are resolved by platform and architecture, with an environment override retained for development and tests.

## CyberCam Board Package

The board package follows `aily-blockly-boards/开发板规范.md` and its compliance checks. It contains:

- `package.json` with required board identity, version, brand, and dependencies;
- `board.json` with Python mode, CanMV runtime metadata, board capabilities, pins, and device identifiers;
- `board.webp`;
- `menu.json` and localized menu resources;
- `template/package.json` with exactly one matching board dependency and the CyberCam Blockly library;
- `template/project.abi` with Python entry blocks and a valid empty starter program;
- documentation and supported examples.

The template package board name and version must exactly match the board package compliance rules.

## Complete CyberCam Blockly Library

The dedicated library in `aily-blockly-libraries` follows the repository's required package shape: `package.json`, `block.json`, `toolbox.json`, `generator.js`, localized strings, `readme.md`, and `readme_ai.md`.

The toolbox is divided into independently testable categories:

- Core program flow: Python start, repeat/loop integration, delays, logging, exceptions, and reusable functions.
- Camera: initialization, sensor selection, frame capture, resolution, pixel format, orientation, exposure, gain, white balance, and image transforms.
- Display: initialization, frame display, clear/fill, text, pixels, lines, rectangles, circles, images, rotation, and backlight.
- AI: model loading, inference, classification, detection, face/feature operations supported by the documented CyberCam runtime, result iteration, coordinates, confidence, and labels.
- IO: digital input/output, PWM, ADC, buttons, LEDs, interrupts, and board pin choices sourced from board metadata.
- Communications: UART, I2C, SPI, Wi-Fi, sockets, and HTTP features supported by the board firmware.
- Storage and media: SD/filesystem paths, read/write/list operations, image save/load, and model assets.
- Device utilities: timing, memory/GC, board information, reset, and runtime-safe diagnostics.

Every public block must have a stable type name, localized label and tooltip, input validation, Python generator coverage, a toolbox entry, and AI-readable documentation. APIs not confirmed by the official CyberCam/CanMV reference or executable integration tests are excluded rather than guessed.

## Data Flow

1. Board index supplies CyberCam metadata to the project wizard.
2. The wizard persists `devmode: "python"` and copies the board template.
3. The project loader activates the Python generator and loads the template dependencies.
4. CyberCam `generator.js` registers `Python.forBlock` handlers in the isolated generator realm.
5. Blockly changes produce Python code through the existing generated-code channel.
6. Run sends the generated script to the generic Python runtime adapter.
7. The `canmv-k230` adapter invokes Electron IPC and streams terminal, state, and preview events back to the Blockly panel.

## Error Handling

- Missing or unsupported backend binaries produce an actionable runtime-unavailable state without crashing application startup.
- Backend start, protocol, timeout, and unexpected-exit errors use stable error codes and reject all pending requests.
- Invalid board metadata prevents project creation with a board-package validation message.
- Missing Python generator handlers identify the library and block type that failed.
- Connection loss disables unsafe operations but preserves the local Blockly project and generated source.
- Remote file operations validate paths and surface backend errors without silently mutating local project files.
- Camera preview frames are bounded and listeners are removed when the panel or project closes.

## Testing Strategy

### Main application

- Unit tests for mode normalization, runtime adapter selection, project template creation, Python source emission, preload API, protocol framing, process lifecycle, IPC, remote file codecs, and remote tree modeling.
- Component tests for board-first mode selection and Blockly runtime controls.
- Electron integration tests using a fake backend executable/protocol peer.
- Regression tests proving Arduino and legacy `micropython` projects still load and generate code.

### Board package

- Existing board compliance checks.
- JSON/schema checks for Python/runtime metadata.
- Template dependency and starter-workspace validation.

### Blockly library

- Required-file and package validation.
- JSON parsing and unique block-type checks.
- Generator load tests in Python mode.
- One golden code-generation test for every block family and representative edge cases.
- Hardware smoke checklist covering connect, camera preview, display, AI inference, IO, communications, storage, run/stop, and reconnect.

## Delivery and Integration

Implementation is based on the latest `origin/main`. The previous `83beaad9` runtime foundation is mined for reusable protocol, IPC, binary packaging, terminal, preview, and remote-file code; its hardcoded project type and code-editor wiring are removed.

The work is delivered as coordinated commits across:

1. `aily-blockly` for generic Python mode, CanMV adapter, Blockly runtime panel, packaging, and tests;
2. `aily-blockly-boards` for the CyberCam board package and template;
3. `aily-blockly-libraries` for the complete CyberCam block library.

Final acceptance requires automated tests to pass in all three repositories and the hardware smoke checklist to be ready for the user's device test.
