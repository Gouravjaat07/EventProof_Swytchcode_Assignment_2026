'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, parseDotEnv } = require('../../../src/config/env');

const TOUCHED = [
  'NODE_ENV', 'LOG_LEVEL', 'PORT', 'HOST', 'CALENDAR_ID', 'SWYTCHCODE_BIN',
  'SWYTCHCODE_PROJECT_DIR', 'SWYTCHCODE_TIMEOUT_MS', 'SWYTCHCODE_MAX_ATTEMPTS',
  'SWYTCHCODE_METHOD_EVENTS', 'VERIFY_SEARCH_WINDOW_DAYS', 'EVENTS_MAX_RESULTS',
  'EVENTS_MAX_RANGE_DAYS', 'CORS_ORIGINS', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS',
  'AUDIT_MAX_RECORDS', 'AUDIT_DB_PATH', 'VENUE_ALIASES',
];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const c = loadConfig({ projectRoot: os.tmpdir() + '-eventproof-nope' });
    assert.equal(c.port, 3000);
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.nodeEnv, 'development');
    assert.equal(c.calendarId, 'primary');
    assert.equal(c.swytchcodeTimeoutMs, 15000);
    assert.equal(c.swytchcodeMaxAttempts, 3);
    assert.equal(c.swytchcodeMethodEvents, 'calendar.event.get');
    assert.equal(c.swytchcodeMethodEvent, 'calendar.event.get1');
    assert.equal(c.verifySearchWindowDays, 3);
    assert.deepEqual(c.corsOrigins, []);
    assert.deepEqual(c.venueAliases, {});
    assert.ok(c.auditDbPath.endsWith('eventproof.db'));
    process.env.AUDIT_DB_PATH = ':memory:';
    assert.equal(loadConfig({ projectRoot: '.' }).auditDbPath, ':memory:');
    delete process.env.AUDIT_DB_PATH;
    assert.ok(Object.isFrozen(c));
  });

  it('reads and validates overrides', () => {
    process.env.PORT = '8080';
    process.env.VENUE_ALIASES = 'SVSU Campus=Swami Vivekanand Subharti University;lab=Main Lab';
    process.env.CORS_ORIGINS = 'https://app.example.test,http://localhost:5173';
    const c = loadConfig({ projectRoot: os.tmpdir() + '-eventproof-nope' });
    assert.equal(c.port, 8080);
    assert.deepEqual(c.venueAliases, {
      'svsu campus': 'Swami Vivekanand Subharti University',
      lab: 'Main Lab',
    });
    assert.deepEqual(c.corsOrigins, ['https://app.example.test', 'http://localhost:5173']);
  });

  it('rejects invalid values loudly', () => {
    process.env.PORT = 'abc';
    assert.throws(() => loadConfig({ projectRoot: '.' }), (e) => e.code === 'CONFIGURATION_ERROR');
    delete process.env.PORT;
    process.env.NODE_ENV = 'staging';
    assert.throws(() => loadConfig({ projectRoot: '.' }), (e) => e.code === 'CONFIGURATION_ERROR');
    delete process.env.NODE_ENV;
    process.env.VENUE_ALIASES = 'no-equals-here';
    assert.throws(() => loadConfig({ projectRoot: '.' }), (e) => e.code === 'CONFIGURATION_ERROR');
    delete process.env.VENUE_ALIASES;
    process.env.SWYTCHCODE_METHOD_EVENTS = 'evil tool!';
    assert.throws(() => loadConfig({ projectRoot: '.' }), (e) => e.code === 'CONFIGURATION_ERROR');
  });

  it('loads .env files with real env winning', () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-env-'));
    try {
      fs.writeFileSync(path.join(dir, '.env'), '# comment\nPORT=4000\nQUOTED="a b"\nBADLINE\n');
      process.env.PORT = '5000'; // real env wins over the file
      const c = loadConfig({ projectRoot: dir });
      assert.equal(c.port, 5000);
      delete process.env.PORT;
      assert.equal(loadConfig({ projectRoot: dir }).port, 4000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseDotEnv', () => {
  it('parses the documented subset', () => {
    assert.deepEqual(
      parseDotEnv('# c\nA=1\nB="x y"\nC=\'z\'\nD=\nNOEQ\n1BAD=x\n'),
      { A: '1', B: 'x y', C: 'z', D: '' }
    );
  });
});
