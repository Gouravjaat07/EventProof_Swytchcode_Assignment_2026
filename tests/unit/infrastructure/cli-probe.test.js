'use strict';

// CLI probe tests. `cliVersion()` runs the REAL local binary when present
// (offline-safe); assertions only pin the response SHAPE so the test is green
// with or without an installed CLI. Auth parsing is covered structurally:
// any outcome must be a valid enum member, never a throw.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createCliProbe } = require('../../../src/infrastructure/swytchcode/cli-probe');

describe('CliProbe', () => {
  it('reports CLI availability in a stable shape', () => {
    const out = createCliProbe().cliVersion();
    assert.equal(typeof out.available, 'boolean');
    if (out.available) {
      assert.match(out.version, /^\d+\.\d+\.\d+/);
    } else {
      assert.equal(out.version, null);
    }
    // Cached second call returns the same object shape.
    assert.deepEqual(createCliProbe().cliVersion(), out);
  });

  it('auth status is always a valid enum member, never a throw', () => {
    const out = createCliProbe().authStatus();
    assert.ok(['connected', 'not_connected', 'unknown'].includes(out.state));
    assert.ok(Number.isFinite(Date.parse(out.checkedAt)));
  });
});
