'use strict';

// Environment loading + validation. All process.env access for application
// settings flows through here so startup fails fast on bad configuration.
//
// Supported subset of `.env` files (loaded only when the file exists next to
// the project root; real environment variables always win):
//   - one KEY=value per line, `#` starts a comment, blank lines ignored
//   - values may be wrapped in single or double quotes (no escapes, no
//     multiline, no `export` prefix). Anything fancier belongs in real env.

const fs = require('node:fs');
const path = require('node:path');
const { InternalServerError } = require('../shared/errors/app-error');

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

function loadDotEnvFile(projectRoot) {
  const file = path.join(projectRoot, '.env');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
  return parseDotEnv(text);
}

function configError(message) {
  return new InternalServerError('CONFIGURATION_ERROR', message);
}

function missingError(name) {
  // Defensive: every current setting has a default, so this fires only for
  // future required variables. Same code as other config failures.
  return new InternalServerError(
    'CONFIGURATION_ERROR',
    `Missing required environment variable: ${name}.`
  );
}

function intInRange(raw, name, min, max, fallback) {
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw missingError(name);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw configError(`Invalid ${name}: expected an integer between ${min} and ${max}.`);
  }
  return n;
}

function nonEmptyString(raw, name, fallback, maxLen = 1024) {
  if (raw === undefined || raw === '') {
    if (fallback !== undefined) return fallback;
    throw missingError(name);
  }
  if (typeof raw !== 'string' || raw.length > maxLen) {
    throw configError(`Invalid ${name}: expected a string of at most ${maxLen} characters.`);
  }
  return raw;
}

// VENUE_ALIASES format: "alias=Canonical Name;short=Long Name". Both sides are
// trimmed; empty entries are ignored; duplicates resolve to the last entry.
function parseVenueAliases(raw) {
  const map = {};
  if (!raw) return Object.freeze(map);
  for (const entry of String(raw).split(';')) {
    if (!entry.trim()) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw configError(
        'Invalid VENUE_ALIASES: expected entries of the form "alias=Canonical Name" separated by ";".'
      );
    }
    const alias = entry.slice(0, eq).trim().toLowerCase();
    const canonical = entry.slice(eq + 1).trim();
    if (!alias || !canonical) {
      throw configError('Invalid VENUE_ALIASES: alias and canonical name must both be non-empty.');
    }
    map[alias] = canonical;
  }
  return Object.freeze(map);
}

function parseOrigins(raw) {
  if (!raw) return Object.freeze([]);
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins) {
    if (!/^https?:\/\/[^/\s]+(:\d+)?$/.test(origin)) {
      throw configError(
        'Invalid CORS_ORIGINS: expected a comma-separated list of origins like "https://app.example.com".'
      );
    }
  }
  return Object.freeze(origins);
}

function resolveDbPath(raw, projectRoot) {
  if (raw === ':memory:') return raw;
  return path.isAbsolute(raw) ? raw : path.join(projectRoot, raw);
}

function loadConfig(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const fileVars = loadDotEnvFile(projectRoot);
  const env = { ...fileVars, ...process.env };

  const nodeEnv = (env.NODE_ENV || 'development').toLowerCase();
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw configError('Invalid NODE_ENV: expected development, test, or production.');
  }

  const logLevel = (env.LOG_LEVEL || 'info').toLowerCase();
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw configError('Invalid LOG_LEVEL: expected debug, info, warn, or error.');
  }

  const config = {
    nodeEnv,
    logLevel,
    port: intInRange(env.PORT, 'PORT', 1, 65535, 3000),
    host: nonEmptyString(env.HOST, 'HOST', '127.0.0.1', 256),
    calendarId: nonEmptyString(env.CALENDAR_ID, 'CALENDAR_ID', 'primary', 256),
    swytchcodeBin: env.SWYTCHCODE_BIN ? nonEmptyString(env.SWYTCHCODE_BIN, 'SWYTCHCODE_BIN', undefined, 1024) : undefined,
    swytchcodeProjectDir: nonEmptyString(
      env.SWYTCHCODE_PROJECT_DIR, 'SWYTCHCODE_PROJECT_DIR', projectRoot, 1024
    ),
    swytchcodeTimeoutMs: intInRange(env.SWYTCHCODE_TIMEOUT_MS, 'SWYTCHCODE_TIMEOUT_MS', 1000, 120000, 15000),
    swytchcodeMaxAttempts: intInRange(env.SWYTCHCODE_MAX_ATTEMPTS, 'SWYTCHCODE_MAX_ATTEMPTS', 1, 5, 3),
    swytchcodeMethodEvents: nonEmptyString(
      env.SWYTCHCODE_METHOD_EVENTS, 'SWYTCHCODE_METHOD_EVENTS', 'calendar.event.get', 256
    ),
    swytchcodeMethodEvent: nonEmptyString(
      env.SWYTCHCODE_METHOD_EVENT, 'SWYTCHCODE_METHOD_EVENT', 'calendar.event.get1', 256
    ),
    verifySearchWindowDays: intInRange(
      env.VERIFY_SEARCH_WINDOW_DAYS, 'VERIFY_SEARCH_WINDOW_DAYS', 1, 30, 3
    ),
    eventsMaxResults: intInRange(env.EVENTS_MAX_RESULTS, 'EVENTS_MAX_RESULTS', 1, 250, 50),
    eventsMaxRangeDays: intInRange(env.EVENTS_MAX_RANGE_DAYS, 'EVENTS_MAX_RANGE_DAYS', 1, 366, 366),
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    rateLimitMax: intInRange(env.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 1, 100000, 60),
    rateLimitWindowMs: intInRange(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 1000, 3600000, 60000),
    auditMaxRecords: intInRange(env.AUDIT_MAX_RECORDS, 'AUDIT_MAX_RECORDS', 1, 100000, 500),
    auditDbPath: resolveDbPath(
      nonEmptyString(env.AUDIT_DB_PATH, 'AUDIT_DB_PATH', 'data/eventproof.db', 1024), projectRoot
    ),
    venueAliases: parseVenueAliases(env.VENUE_ALIASES),
  };

  if (!/^[A-Za-z0-9_.-]+$/.test(config.swytchcodeMethodEvents)) {
    throw configError('Invalid SWYTCHCODE_METHOD_EVENTS: expected a canonical tool id.');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(config.swytchcodeMethodEvent)) {
    throw configError('Invalid SWYTCHCODE_METHOD_EVENT: expected a canonical tool id.');
  }

  return Object.freeze(config);
}

module.exports = { loadConfig, parseDotEnv };
