'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    AILY_HOST_AUTH_CHANNEL,
    normalizeAilyHostAuthResult,
    parseAilyHostAuthRequest,
} = require('./aily-host-auth-process-bridge');

test('intercepts host auth requests only for the managed Aily Chat Runtime', () => {
    const message = {
        channel: AILY_HOST_AUTH_CHANNEL,
        type: 'request',
        requestId: 'request-1',
        operation: 'access-token',
    };

    assert.deepEqual(parseAilyHostAuthRequest('other-tool', message), { handled: false });
    assert.deepEqual(parseAilyHostAuthRequest('aily-chat', { ...message, channel: 'other' }), { handled: false });
    assert.deepEqual(parseAilyHostAuthRequest('aily-chat', message), {
        handled: true,
        valid: true,
        requestId: 'request-1',
        operation: 'access-token',
    });
});

test('forwards only the protocol fields accepted by the main-window auth service', () => {
    const parsed = parseAilyHostAuthRequest('aily-chat', {
        channel: AILY_HOST_AUTH_CHANNEL,
        type: 'request',
        requestId: 'request-2',
        operation: 'refresh-access-token',
        rejectedGeneration: 8,
        accessToken: 'must-not-be-forwarded',
        arbitrary: { value: true },
    });

    assert.deepEqual(parsed, {
        handled: true,
        valid: true,
        requestId: 'request-2',
        operation: 'refresh-access-token',
        rejectedGeneration: 8,
    });
});

test('rejects unsupported operations before they reach the main window', () => {
    const parsed = parseAilyHostAuthRequest('aily-chat', {
        channel: AILY_HOST_AUTH_CHANNEL,
        type: 'request',
        requestId: 'request-3',
        operation: 'read-refresh-token',
    });

    assert.equal(parsed.handled, true);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.result.errorCode, 'HOST_AUTH_INVALID_REQUEST');
});

test('normalizes host responses and strips unrelated fields', () => {
    assert.deepEqual(normalizeAilyHostAuthResult({
        ok: true,
        authenticated: true,
        accessToken: '  host-token  ',
        generation: 9,
        refreshToken: 'must-not-cross-the-process-bridge',
    }), {
        ok: true,
        authenticated: true,
        accessToken: 'host-token',
        generation: 9,
    });
});
