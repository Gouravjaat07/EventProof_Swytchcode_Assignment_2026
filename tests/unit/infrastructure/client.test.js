'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSwytchcodeClient } = require('../../../src/infrastructure/swytchcode/swytchcode.client');

// Minimal SwytchcodeError shape (message/cause/details), as thrown by the SDK.
function sdkError(message, cause, details) {
  const err = new Error(message);
  err.name = 'SwytchcodeError';
  err.cause = cause;
  err.details = details;
  return err;
}

function silentLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {} };
  l.child = () => l;
  return l;
}

describe('SwytchcodeClient', () => {
  it('extracts documented {success,result} envelopes with metadata', async () => {
    const seen = [];
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async (tool, stdin, opts) => {
        seen.push({ tool, stdin, opts });
        return { success: true, result: { items: [] } };
      },
    });
    const out = await client.execute({ tool: 'calendar.event.get', params: { calendarId: 'primary' } });
    assert.deepEqual(out.data, { items: [] });
    assert.equal(out.meta.tool, 'calendar.event.get');
    assert.equal(out.meta.attempts, 1);
    assert.equal(typeof out.meta.durationMs, 'number');
    assert.deepEqual(seen[0].stdin, { params: { calendarId: 'primary' } });
    assert.equal(seen[0].opts.timeoutMs, 15000);
  });

  it('accepts bare payloads and coerces/strips params', async () => {
    let stdin;
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async (t, s) => { stdin = s; return { kind: 'calendar#events', items: [] }; },
    });
    const out = await client.execute({
      tool: 'a.b.c', params: { n: 5, b: true, nil: null, empty: '', keep: 'x' },
    });
    assert.deepEqual(out.data, { kind: 'calendar#events', items: [] });
    assert.deepEqual(stdin, { params: { n: '5', b: 'true', keep: 'x' } });
  });

  it('rejects invalid tool ids and params without executing', async () => {
    let calls = 0;
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async () => { calls += 1; return {}; },
    });
    await assert.rejects(() => client.execute({ tool: 'bad id!' }), (e) => e.code === 'CONFIGURATION_ERROR');
    await assert.rejects(() => client.execute({ tool: 'a.b', params: { arr: [1] } }), (e) => e.code === 'CONFIGURATION_ERROR');
    assert.equal(calls, 0);
  });

  it('REFUSES simulated payloads (anti-fabrication guard)', async () => {
    let calls = 0;
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async () => {
        calls += 1;
        return { demo: true, _simulated: true, data: { items: [] }, summary: 'x' };
      },
    });
    await assert.rejects(() => client.execute({ tool: 'a.b' }), (e) => e.code === 'SWYTCHCODE_SIMULATED_DATA');
    assert.equal(calls, 1); // never retried
  });

  it('rejects failed and malformed envelopes', async () => {
    const failing = (payload) =>
      createSwytchcodeClient({ logger: silentLogger(), executor: async () => payload });
    await assert.rejects(() => failing({ success: false }).execute({ tool: 'a.b' }), (e) => e.code === 'SWYTCHCODE_EXECUTION_FAILED');
    await assert.rejects(() => failing('just a string').execute({ tool: 'a.b' }), (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE');
    await assert.rejects(() => failing({ result: 42 }).execute({ tool: 'a.b' }), (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE');
  });

  it('maps in-200 provider statuses', async () => {
    const run = (payload) =>
      createSwytchcodeClient({ logger: silentLogger(), maxAttempts: 1, executor: async () => payload }).execute({ tool: 'a.b' });
    await assert.rejects(() => run({ status_code: 404, error_category: 'not_found' }), (e) => e.code === 'EVENT_NOT_FOUND');
    await assert.rejects(() => run({ status_code: 401 }), (e) => e.code === 'AUTH_EXPIRED');
    await assert.rejects(() => run({ status_code: 403 }), (e) => e.code === 'EVENT_SOURCE_PERMISSION_DENIED');
    await assert.rejects(() => run({ status_code: 400 }), (e) => e.code === 'SWYTCHCODE_EXECUTION_FAILED');
  });

  it('maps CLI exit codes and never retries fail-closed classes', async () => {
    const cases = [
      [2, 'SWYTCHCODE_OPERATION_NOT_FOUND'],
      [3, 'AUTH_REQUIRED'],
      [6, 'SWYTCHCODE_POLICY_BLOCKED'],
      [7, 'SWYTCHCODE_APPROVAL_REQUIRED'],
      [1, 'SWYTCHCODE_EXECUTION_FAILED'],
    ];
    for (const [code, expected] of cases) {
      let calls = 0;
      const client = createSwytchcodeClient({
        logger: silentLogger(),
        executor: async () => { calls += 1; throw sdkError(`exit ${code}`, code); },
      });
      await assert.rejects(() => client.execute({ tool: 'a.b' }), (e) => e.code === expected);
      assert.equal(calls, 1, `exit ${code} must not retry`);
    }
    // Expired auth sniffs to AUTH_EXPIRED with SDK details passed through.
    const exp = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async () => { throw sdkError('token expired', 3, { category: 'auth', retryable: false }); },
    });
    await assert.rejects(() => exp.execute({ tool: 'a.b' }), (e) => e.code === 'AUTH_EXPIRED' && e.details.category === 'auth');
  });

  it('maps spawn/timeout failures', async () => {
    const enoent = createSwytchcodeClient({
      logger: silentLogger(), maxAttempts: 1,
      executor: async () => { throw sdkError('Failed to spawn swytchcode; is the CLI installed?'); },
    });
    await assert.rejects(() => enoent.execute({ tool: 'a.b' }), (e) => e.code === 'SWYTCHCODE_NOT_INSTALLED');

    let calls = 0;
    const timeout = createSwytchcodeClient({
      logger: silentLogger(), maxAttempts: 2, sleeper: async () => {},
      executor: async () => { calls += 1; throw sdkError('swytchcode exec timed out after 15000ms'); },
    });
    await assert.rejects(() => timeout.execute({ tool: 'a.b' }), (e) => e.code === 'EVENT_SOURCE_TIMEOUT');
    assert.equal(calls, 2);
  });

  it('retries transient failures with bounded exponential backoff, then succeeds', async () => {
    const sleeps = [];
    let calls = 0;
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      maxAttempts: 3,
      sleeper: async (ms) => { sleeps.push(ms); },
      executor: async () => {
        calls += 1;
        if (calls === 1) throw sdkError('network unreachable', 4);
        if (calls === 2) return { status_code: 429, error_category: 'rate_limited' };
        return { success: true, result: { ok: true } };
      },
    });
    const out = await client.execute({ tool: 'a.b' });
    assert.deepEqual(out.data, { ok: true });
    assert.equal(out.meta.attempts, 3);
    assert.equal(sleeps.length, 2);
    assert.ok(sleeps[0] >= 250 && sleeps[0] < 500, `first backoff in [250,500): ${sleeps[0]}`);
    assert.ok(sleeps[1] >= 500 && sleeps[1] < 750, `second backoff in [500,750): ${sleeps[1]}`);
  });

  it('gives up after maxAttempts (INVARIANT 10: no indefinite retries)', async () => {
    let calls = 0;
    const client = createSwytchcodeClient({
      logger: silentLogger(), maxAttempts: 3, sleeper: async () => {},
      executor: async () => { calls += 1; return { status_code: 500, error_category: 'upstream' }; },
    });
    await assert.rejects(() => client.execute({ tool: 'a.b' }), (e) => e.code === 'EVENT_SOURCE_UNAVAILABLE');
    assert.equal(calls, 3);
  });

  it('rethrows application errors untouched', async () => {
    const { NotFoundError } = require('../../../src/shared/errors/app-error');
    const sentinel = new NotFoundError('EVENT_NOT_FOUND', 'x');
    const client = createSwytchcodeClient({
      logger: silentLogger(),
      executor: async () => { throw sentinel; },
    });
    await assert.rejects(() => client.execute({ tool: 'a.b' }), (e) => e === sentinel);
  });
});
