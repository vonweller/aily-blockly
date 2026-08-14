const assert = require('node:assert/strict');
const test = require('node:test');

const {
  cleanupTemporaryProject,
} = require('./e2e-temp-project-cleanup');

test('leaves the project and retries transient Windows directory removal errors', async () => {
  const events = [];
  let attempts = 0;

  await cleanupTemporaryProject({
    target: 'C:/Temp/project',
    leaveProject: async () => { events.push('leave'); },
    removeDirectory: async () => {
      attempts += 1;
      events.push(`remove-${attempts}`);
      if (attempts < 3) {
        const error = new Error('directory still watched');
        error.code = attempts === 1 ? 'ENOTEMPTY' : 'EPERM';
        throw error;
      }
    },
    delay: async () => { events.push('delay'); },
  });

  assert.deepEqual(events, [
    'leave',
    'remove-1',
    'delay',
    'remove-2',
    'delay',
    'remove-3',
  ]);
});

test('preserves a primary test failure when cleanup also fails', async () => {
  const primaryError = new Error('original assertion failure');
  const warnings = [];

  await cleanupTemporaryProject({
    target: 'C:/Temp/project',
    primaryError,
    leaveProject: async () => undefined,
    removeDirectory: async () => {
      const error = new Error('cleanup failed');
      error.code = 'EACCES';
      throw error;
    },
    delay: async () => undefined,
    attempts: 2,
    warn: message => warnings.push(message),
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cleanup failed/);
});

test('throws cleanup failure when no primary test failure exists', async () => {
  await assert.rejects(
    cleanupTemporaryProject({
      target: 'C:/Temp/project',
      leaveProject: async () => undefined,
      removeDirectory: async () => {
        const error = new Error('cleanup failed');
        error.code = 'ENOTEMPTY';
        throw error;
      },
      delay: async () => undefined,
      attempts: 2,
    }),
    /cleanup failed/,
  );
});
