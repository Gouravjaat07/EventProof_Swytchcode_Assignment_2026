'use strict';

// CLI probe: safe, read-only Swytchcode diagnostics for the status endpoint.
//
// - Spawns only FIXED command strings (`--version`, `auth status`) with no
//   user input anywhere near the argv, so `shell: true` (required for Windows
//   .cmd shims) cannot inject anything.
// - Short timeouts; every failure degrades to "unknown", never to a guess.
// - `auth status` output format is NOT assumed: "connected" is reported only
//   when the output affirmatively says connected, "not_connected" only when
//   it affirmatively says otherwise, and "unknown" in every other case
//   (including all spawn/network failures).

const { spawnSync } = require('node:child_process');

const PROBE_TIMEOUT_MS = 8000;
const VERSION_CACHE_TTL_MS = 60000;

function runFixed(command) {
  try {
    const r = spawnSync(command, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      shell: true,
      windowsHide: true,
    });
    return {
      ok: r.status === 0,
      status: r.status,
      stdout: typeof r.stdout === 'string' ? r.stdout : '',
      stderr: typeof r.stderr === 'string' ? r.stderr : '',
      error: r.error ? String((r.error && r.error.code) || r.error) : null,
    };
  } catch (err) {
    return { ok: false, status: null, stdout: '', stderr: '', error: String(err && err.message ? err.message : err) };
  }
}

function binary() {
  const override = (process.env.SWYTCHCODE_BIN || '').trim();
  if (override) return `"${override}"`;
  return 'swytchcode';
}

function createCliProbe() {
  let versionCache = null;

  function cliVersion() {
    const now = Date.now();
    if (versionCache && versionCache.expiresAt > now) return versionCache.value;
    const r = runFixed(`${binary()} --version`);
    const m = /swytchcode version (\S+)/i.exec(`${r.stdout}\n${r.stderr}`);
    const value = r.ok && m
      ? { available: true, version: m[1] }
      : { available: false, version: null };
    versionCache = { value, expiresAt: now + VERSION_CACHE_TTL_MS };
    return value;
  }

  function authStatus() {
    const checkedAt = new Date().toISOString();
    const r = runFixed(`${binary()} auth status`);
    if (!r.ok) return { state: 'unknown', checkedAt };
    const text = `${r.stdout}\n${r.stderr}`;
    if (/not connected|no connected|disconnected/i.test(text)) {
      return { state: 'not_connected', checkedAt };
    }
    if (/connected/i.test(text)) {
      return { state: 'connected', checkedAt };
    }
    return { state: 'unknown', checkedAt };
  }

  return { cliVersion, authStatus };
}

module.exports = { createCliProbe, PROBE_TIMEOUT_MS };
