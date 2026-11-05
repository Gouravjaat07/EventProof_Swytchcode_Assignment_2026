'use strict';

// Real-CLI smoke test (offline-capable part runs anywhere; live part is gated).
//
// What it proves with GENUINE `swytchcode` executions (no mocks):
//   1. the CLI binary resolves and reports its version
//   2. `doctor` passes on this project
//   3. `demo list` works offline (transport sanity)
//   4. `exec <unknown> --json` yields the real classified-error envelope
//      (exit 2) that the client maps — the envelope is asserted structurally
//   5. `exec stripe.create_payment --demo --json` yields genuine CLI bytes
//      carrying demo markers, and the REAL SwytchcodeClient refuses them as
//      SWYTCHCODE_SIMULATED_DATA (anti-fabrication guard, verified end to end)
//
// Live execution (a real provider call) runs ONLY when SWYTCHCODE_SMOKE_LIVE=1
// AND the environment has direct network + provider auth. Otherwise it is
// reported BLOCKED (never faked). In this sandbox the CLI cannot dial out,
// so expect LIVE: BLOCKED here and run it from an unrestricted terminal.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createSwytchcodeClient } = require('../src/infrastructure/swytchcode/swytchcode.client');

const ROOT = path.join(__dirname, '..');
const results = [];

function report(name, status, evidence) {
  results.push({ name, status, evidence });
  process.stdout.write(`${status === 'PASS' ? 'PASS' : status} ${name}${evidence ? ` — ${evidence}` : ''}\n`);
}

function resolveBin() {
  if (process.env.SWYTCHCODE_BIN && fs.existsSync(process.env.SWYTCHCODE_BIN)) return process.env.SWYTCHCODE_BIN;
  const local = path.join(ROOT, 'tools', 'cli', 'node_modules', '.bin', process.platform === 'win32' ? 'swytchcode.cmd' : 'swytchcode');
  if (fs.existsSync(local)) return local;
  return 'swytchcode';
}

// All argv values below are hardcoded constants (never user input); shell:true
// exists only to launch Windows .cmd shims.
function runCli(bin, args, input) {
  const quoted = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  return spawnSync(`"${bin}" ${quoted}`, {
    cwd: ROOT,
    input,
    encoding: 'utf8',
    timeout: 60000,
    shell: true,
    env: { ...process.env },
  });
}

async function main() {
  const bin = resolveBin();

  // 1. version
  let r = runCli(bin, ['--version']);
  if (r.status === 0 && /swytchcode version \S+/.test(r.stdout)) {
    report('cli-version', 'PASS', r.stdout.trim().split('\n')[0]);
  } else {
    report('cli-version', 'FAIL', `exit=${r.status} stderr=${(r.stderr || '').slice(0, 200)}`);
  }

  // 2. doctor
  r = runCli(bin, ['doctor']);
  if (r.status === 0) report('doctor', 'PASS', 'exit 0');
  else report('doctor', 'FAIL', `exit=${r.status} ${(r.stderr || '').slice(0, 200)}`);

  // 3. demo list (offline transport sanity)
  r = runCli(bin, ['demo', 'list']);
  if (r.status === 0 && /stripe/i.test(r.stdout)) report('demo-list', 'PASS', 'stripe demo advertised');
  else report('demo-list', 'FAIL', `exit=${r.status}`);

  // 4. unknown-tool classified envelope (exit 2)
  r = runCli(bin, ['exec', 'nonexistent.tool', '--json']);
  let classified = null;
  try {
    classified = JSON.parse((r.stderr || '').trim().split('\n').filter(Boolean).pop() || '');
  } catch { classified = null; }
  if (r.status === 2 && classified && typeof classified.error === 'string' && typeof classified.category === 'string') {
    report('unknown-tool-envelope', 'PASS', `exit 2, category=${classified.category}`);
  } else {
    report('unknown-tool-envelope', 'FAIL', `exit=${r.status} stderr=${(r.stderr || '').slice(0, 200)}`);
  }

  // 5. demo bytes through the real client guard
  r = runCli(bin, ['exec', 'stripe.create_payment', '--demo', '--json'], JSON.stringify({ amount: 5000, currency: 'usd' }));
  let demoPayload = null;
  try {
    demoPayload = JSON.parse((r.stdout || '').trim());
  } catch { demoPayload = null; }
  if (r.status === 0 && demoPayload && demoPayload.demo === true && demoPayload._simulated === true) {
    const client = createSwytchcodeClient({
      executor: async () => demoPayload, // genuine captured bytes, verbatim
      logger: null,
    });
    try {
      await client.execute({ tool: 'stripe.create_payment', params: { amount: '5000' } });
      report('demo-guard', 'FAIL', 'client accepted simulated data');
    } catch (err) {
      if (err && err.code === 'SWYTCHCODE_SIMULATED_DATA') {
        report('demo-guard', 'PASS', 'client refused demo payload with SWYTCHCODE_SIMULATED_DATA');
      } else {
        report('demo-guard', 'FAIL', `unexpected error ${(err && err.code) || err}`);
      }
    }
  } else {
    report('demo-guard', 'FAIL', `demo exec did not yield marked payload (exit=${r.status})`);
  }

  // 6. LIVE (gated — never simulated). Same operation the backend is
  // configured with (SWYTCHCODE_METHOD_EVENTS). HTTP 200 with an empty
  // `items` array is a SUCCESSFUL execution (empty calendar), not a failure.
  if (process.env.SWYTCHCODE_SMOKE_LIVE === '1') {
    const live = runCli(
      bin,
      ['exec', 'calendar.event.get', '--json'],
      JSON.stringify({ params: { calendarId: 'primary', maxResults: '1', singleEvents: 'true' } })
    );
    if (live.status === 0) {
      let parsed = null;
      try { parsed = JSON.parse((live.stdout || '').trim()); } catch { parsed = null; }
      const notSimulated = !!parsed && parsed.demo !== true && parsed._simulated !== true;
      const statusOk = !!parsed && (parsed.status_code === undefined || parsed.status_code === 200);
      const payload = parsed && typeof parsed === 'object'
        ? ('result' in parsed ? parsed.result : 'data' in parsed ? parsed.data : parsed)
        : null;
      const itemsOk = payload && typeof payload === 'object' && (payload.items === undefined || Array.isArray(payload.items));
      const itemsCount = itemsOk && Array.isArray(payload.items) ? payload.items.length : 0;
      const pass = notSimulated && statusOk && itemsOk;
      report('live-exec', pass ? 'PASS' : 'FAIL', `exit 0, live-shape=${notSimulated}, status-ok=${statusOk}, items-array=${itemsOk}, items=${itemsCount}`);
    } else {
      report('live-exec', 'FAIL', `exit=${live.status} stderr=${(live.stderr || '').slice(0, 300)}`);
    }
  } else {
    report(
      'live-exec',
      'BLOCKED',
      'set SWYTCHCODE_SMOKE_LIVE=1 with network + `swy login` + `swy auth connect` to run; ' +
        'command: swytchcode exec calendar.event.get --json (stdin: calendarId=primary)'
    );
  }

  const failed = results.filter((x) => x.status === 'FAIL').length;
  const passed = results.filter((x) => x.status === 'PASS').length;
  const blocked = results.filter((x) => x.status === 'BLOCKED').length;
  process.stdout.write(`smoke: ${passed} passed, ${failed} failed, ${blocked} blocked\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`smoke crashed: ${(err && err.message) || err}\n`);
  process.exit(1);
});
