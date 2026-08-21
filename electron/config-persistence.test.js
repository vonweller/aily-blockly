const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeConfigChanges } = require('./config-persistence');

test('preserves a newer region when a stale renderer changes an unrelated setting', () => {
  const base = { region: 'cn', theme: 'default', selectedLanguage: 'zh_cn' };
  const next = { region: 'cn', theme: 'light', selectedLanguage: 'zh_cn' };
  const latest = { region: 'eu', theme: 'default', selectedLanguage: 'zh_cn' };

  assert.deepEqual(mergeConfigChanges(base, next, latest), {
    region: 'eu',
    theme: 'light',
    selectedLanguage: 'zh_cn',
  });
});

test('applies an intentional region change from the renderer', () => {
  const base = { region: 'cn', theme: 'default' };
  const next = { region: 'eu', theme: 'default' };
  const latest = { region: 'cn', theme: 'light' };

  assert.deepEqual(mergeConfigChanges(base, next, latest), {
    region: 'eu',
    theme: 'light',
  });
});

test('merges independent nested changes without replacing the whole section', () => {
  const base = { blockly: { closeFlyoutAfterBlock: false, grid: true } };
  const next = { blockly: { closeFlyoutAfterBlock: true, grid: true } };
  const latest = { blockly: { closeFlyoutAfterBlock: false, grid: false } };

  assert.deepEqual(mergeConfigChanges(base, next, latest), {
    blockly: { closeFlyoutAfterBlock: true, grid: false },
  });
});

test('preserves newly added fields and applies intentional deletions', () => {
  const base = { retained: true, removed: true };
  const next = { retained: true };
  const latest = { retained: true, removed: true, addedElsewhere: 1 };

  assert.deepEqual(mergeConfigChanges(base, next, latest), {
    retained: true,
    addedElsewhere: 1,
  });
});
