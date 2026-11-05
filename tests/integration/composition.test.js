'use strict';

// Production composition test: builds the REAL server wiring (real config
// load, real SDK require, real provider/client instances) without binding a
// socket, then hits the local-only /health route. This is the test that would
// have caught the missing-`zod` startup crash (the SDK requires its "optional"
// peer at load time). No test here touches the network or the CLI binary.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const inject = require('light-my-request');

const ROOT = path.join(__dirname, '..', '..');
const TOUCHED = ['NODE_ENV', 'LOG_LEVEL', 'PORT', 'HOST', 'AUDIT_DB_PATH'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error'; // keep test output clean
  process.env.AUDIT_DB_PATH = ':memory:'; // never touch the real database file
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('production composition', () => {
  it('requires the real SDK entry (packaging assumption)', () => {
    const sdk = require('@swytchcode/runtime');
    assert.equal(typeof sdk.exec, 'function');
  });

  it('composes config, client, provider, services, and app', async () => {
    const { compose } = require('../../src/interfaces/http/server');
    const wired = compose(ROOT);
    assert.equal(wired.config.host, '127.0.0.1');
    assert.equal(typeof wired.app, 'function');
    assert.equal(typeof wired.eventSource.getEventById, 'function');
    assert.equal(typeof wired.verifyService.verify, 'function');

    const res = await inject(wired.app, { method: 'GET', url: '/api/v1/health' });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).data.status, 'ok');
  });
});
