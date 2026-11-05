'use strict';

// Minimal structured JSON logger (no dependencies).
//
// - One JSON object per line: { ts, level, service, msg, ...fields }.
// - `error` goes to stderr, everything else to stdout.
// - Field values are redacted before serialization: any object key that looks
//   like a credential is replaced with "[REDACTED]", and credentials embedded
//   in URLs (scheme://user:password@host) are scrubbed from strings.
// - Limitation: standalone secret *values* under innocent-looking keys cannot
//   be detected. Callers must never log raw auth headers, tokens, or request
//   bodies containing credentials.

const SECRET_KEY_RE =
  /(token|secret|password|passwd|pwd|authorization|cookie|api[-_]?key|access[-_]?key|private[-_]?key|client[-_]?secret|bearer|x-api-key)/i;
const URL_CREDS_RE = /(\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:]+:)([^@/s]+)(@)/g;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

function redactString(s) {
  return s.replace(URL_CREDS_RE, `$1${REDACTED}$3`);
}

function redact(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: typeof value.message === 'string' ? redactString(value.message) : value.message,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

function createLogger(options = {}) {
  const levelName = (options.level || 'info').toLowerCase();
  const threshold = LEVELS[levelName] ?? LEVELS.info;
  const service = options.service || 'eventproof';
  const bindings = options.bindings ? { ...options.bindings } : {};

  function emit(level, msg, fields) {
    if (LEVELS[level] < threshold) return;
    const record = { ts: new Date().toISOString(), level, service, msg, ...bindings };
    if (fields && typeof fields === 'object') Object.assign(record, redact(fields));
    const line = JSON.stringify(record);
    if (level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (extra) => createLogger({ level: levelName, service, bindings: { ...bindings, ...extra } }),
  };
}

module.exports = { createLogger, redact };
