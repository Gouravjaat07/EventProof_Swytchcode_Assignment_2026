'use strict';

// Provider fetch telemetry: a tiny append-only log of upstream fetch outcomes
// (success/failure + error category, no payloads, no secrets) backing the
// integration-status page's "last successful/failed fetch" indicators.

function createSQLiteFetchLog({ db }) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('SQLiteFetchLog requires an open DatabaseSync handle.');
  }

  async function record({ outcome, errorCategory, at }) {
    db.prepare('INSERT INTO provider_fetch_log (at, outcome, error_category) VALUES (?, ?, ?)').run(
      at || new Date().toISOString(),
      outcome,
      errorCategory || null
    );
    // Bounded retention: keep the newest 200 rows.
    db.exec(
      'DELETE FROM provider_fetch_log WHERE id NOT IN (SELECT id FROM provider_fetch_log ORDER BY id DESC LIMIT 200)'
    );
  }

  async function last() {
    const success = db
      .prepare("SELECT at FROM provider_fetch_log WHERE outcome = 'success' ORDER BY id DESC LIMIT 1")
      .get();
    const failure = db
      .prepare('SELECT at, error_category FROM provider_fetch_log ORDER BY id DESC LIMIT 1')
      .get();
    const latestFailure = db
      .prepare("SELECT at, error_category FROM provider_fetch_log WHERE outcome = 'failure' ORDER BY id DESC LIMIT 1")
      .get();
    return {
      lastSuccessAt: success ? success.at : null,
      lastFailureAt: latestFailure ? latestFailure.at : null,
      lastErrorCategory: latestFailure ? latestFailure.error_category : null,
      lastOutcomeAt: failure ? failure.at : null,
    };
  }

  return { record, last };
}

module.exports = { createSQLiteFetchLog };
