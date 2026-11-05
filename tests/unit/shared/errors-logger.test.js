'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ApplicationError, ValidationError, InternalServerError, isApplicationError,
} = require('../../../src/shared/errors/app-error');
const { statusFor } = require('../../../src/shared/errors/codes');
const { createLogger, redact } = require('../../../src/shared/logging/logger');

describe('errors', () => {
  it('derives HTTP status from the code registry', () => {
    assert.equal(statusFor('EVENT_NOT_FOUND'), 404);
    assert.equal(statusFor('BOGUS_CODE'), 500);
    const e = new ValidationError('INVALID_DATE', 'bad date');
    assert.equal(e.status, 422);
    assert.ok(isApplicationError(e));
    assert.ok(!isApplicationError(new Error('x')));
  });

  it('serializes safely: cause and stack never leak', () => {
    const cause = new Error('connect ECONNREFUSED 10.0.0.1 (secret=hunter2)');
    const e = new InternalServerError('SWYTCHCODE_EXECUTION_FAILED', 'safe message', {
      details: { attempt: 2 },
      cause,
    });
    const json = JSON.parse(JSON.stringify(e));
    assert.deepEqual(json, { code: 'SWYTCHCODE_EXECUTION_FAILED', message: 'safe message', details: { attempt: 2 } });
    assert.ok(!JSON.stringify(json).includes('hunter2'));
    assert.ok(!JSON.stringify(json).includes('at '));
  });
});

describe('logger redaction', () => {
  it('redacts credential-like keys at any depth', () => {
    const out = redact({
      user: 'alice',
      token: 'abc',
      nested: { password: 'x', apiKey: 'y', fine: 1 },
      list: [{ authorization: 'Bearer [REDACTED]' }],
    });
    assert.equal(out.user, 'alice');
    assert.equal(out.token, '[REDACTED]');
    assert.equal(out.nested.password, '[REDACTED]');
    assert.equal(out.nested.apiKey, '[REDACTED]');
    assert.equal(out.nested.fine, 1);
    assert.equal(out.list[0].authorization, '[REDACTED]');
  });

  it('scrubs credentials embedded in URLs', () => {
    assert.equal(
      redact({ url: 'https://alice:hunter2@example.test/x' }).url,
      'https://alice:[REDACTED]@example.test/x'
    );
    assert.equal(redact({ url: 'https://example.test/x' }).url, 'https://example.test/x');
  });

  it('survives circular structures and errors', () => {
    const c = { a: 1 };
    c.self = c;
    assert.equal(redact(c).self, '[CIRCULAR]');
    const asErr = redact({ err: new Error('boom') });
    assert.equal(asErr.err.message, 'boom');
    assert.equal(asErr.err.stack, undefined);
  });

  it('emits JSON lines with bindings and level filtering', () => {
    const logger = createLogger({ level: 'warn', service: 't' });
    const lines = [];
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = (s) => { lines.push(s); return true; };
    process.stderr.write = (s) => { lines.push(s); return true; };
    try {
      logger.info('dropped by level', {});
      logger.child({ requestId: 'r1' }).warn('kept', { token: 'secret' });
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.level, 'warn');
    assert.equal(record.requestId, 'r1');
    assert.equal(record.token, '[REDACTED]');
    assert.ok(Date.parse(record.ts));
  });
});
