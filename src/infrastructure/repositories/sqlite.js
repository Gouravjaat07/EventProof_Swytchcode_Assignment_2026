'use strict';

// SQLite store: opens the audit database file and applies versioned
// migrations. Uses the built-in `node:sqlite` (zero new dependencies).
//
// - Relative paths resolve against `projectRoot`; parent dirs are created.
// - `:memory:` is honored (tests) and skips directory creation.
// - Migrations are idempotent and tracked via `PRAGMA user_version`.
// - Any failure throws a plain Error with an actionable message: the server
//   fails fast at startup rather than running without durable history.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

const MIGRATIONS = [
  // v1: verification audit + provider fetch telemetry.
  `
  CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    source_event_id TEXT NOT NULL,
    event_title TEXT,
    summary_json TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    event_ref_json TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    request_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);
  CREATE INDEX IF NOT EXISTS idx_verifications_verified_at ON verifications(verified_at);
  CREATE INDEX IF NOT EXISTS idx_verifications_source_event ON verifications(source_event_id);
  CREATE TABLE IF NOT EXISTS provider_fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    outcome TEXT NOT NULL,
    error_category TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fetch_log_at ON provider_fetch_log(at);
  `,
];

function resolveDbPath(dbPath, projectRoot) {
  if (dbPath === ':memory:') return dbPath;
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.join(projectRoot, dbPath);
}

function migrate(db) {
  const row = db.prepare('PRAGMA user_version').get();
  const current = row && typeof row.user_version === 'number' ? row.user_version : 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Audit database schema v${current} is newer than this app supports (v${SCHEMA_VERSION}).`
    );
  }
  for (let v = current; v < SCHEMA_VERSION; v += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Rollback failure: report the original migration error below.
      }
      throw new Error(`Audit database migration to v${v + 1} failed: ${err.message}`);
    }
  }
}

function openDatabase(dbPath, projectRoot) {
  const resolved = resolveDbPath(dbPath, projectRoot || process.cwd());
  if (resolved !== ':memory:') {
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
    } catch (err) {
      throw new Error(`Cannot create audit database directory: ${err.message}`);
    }
  }
  let db;
  try {
    db = new DatabaseSync(resolved);
  } catch (err) {
    throw new Error(`Cannot open audit database at ${resolved === ':memory:' ? ':memory:' : 'the configured path'}: ${err.message}`);
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  try {
    migrate(db);
  } catch (err) {
    try {
      db.close();
    } catch {
      // Ignore close errors; the migration error is what matters.
    }
    throw err;
  }
  return db;
}

module.exports = { openDatabase, resolveDbPath, SCHEMA_VERSION };
