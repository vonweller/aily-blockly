import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUploadDispatchMode } from './upload-dispatch-policy.ts';

test('Coder uploads directly even without a Blockly editor listener', () => {
  assert.equal(resolveUploadDispatchMode({
    isAilyCodeProject: true,
    hasBlocklyUploader: false,
  }), 'coder-direct');
});

test('Coder uploads do not use a stale Blockly editor listener', () => {
  assert.equal(resolveUploadDispatchMode({
    isAilyCodeProject: true,
    hasBlocklyUploader: true,
  }), 'coder-direct');
});

test('Blockly uploads require their editor listener', () => {
  assert.equal(resolveUploadDispatchMode({
    isAilyCodeProject: false,
    hasBlocklyUploader: true,
  }), 'blockly-action');
  assert.equal(resolveUploadDispatchMode({
    isAilyCodeProject: false,
    hasBlocklyUploader: false,
  }), 'unavailable');
});
