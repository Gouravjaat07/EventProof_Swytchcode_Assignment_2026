'use strict';

// Zero-dependency static gate: `node --check` (parse only) over every
// first-party JS file. Run: `npm run check`.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['src', 'tests', 'scripts', path.join('tools', 'relay')];

function collectJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(full, out);
    else if (entry.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

function main() {
  const files = [];
  for (const d of DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) collectJs(abs, files);
  }
  let failed = 0;
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      failed += 1;
      process.stderr.write(`FAIL ${path.relative(ROOT, file)}\n${r.stderr || ''}`);
    }
  }
  process.stdout.write(`check: ${files.length} files, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
