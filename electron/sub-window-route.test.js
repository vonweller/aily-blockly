'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildDevSubWindowRouteUrl,
  normalizeSubWindowRoutePath,
} = require('./sub-window-route');

test('normalizes child routes before a pooled sub-window starts Angular', () => {
  assert.equal(normalizeSubWindowRoutePath('/child-tool/aily-chat'), 'child-tool/aily-chat');
  assert.equal(normalizeSubWindowRoutePath('child-tool/aily-chat'), 'child-tool/aily-chat');
  assert.equal(
    buildDevSubWindowRouteUrl('/child-tool/aily-chat'),
    'http://localhost:4200/#/child-tool/aily-chat',
  );
});
