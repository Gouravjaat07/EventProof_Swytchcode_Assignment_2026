'use strict';

// Port conformance: the in-memory and SQLite audit repositories must behave
// identically (save/getById/list/stats). SQLite tests use scratch files that
// are removed afterwards; restart durability is proven by closing and
// reopening the same file.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createInMemoryAuditRepository } = require('../../../src/infrastructure/repositories/audit.repository');
const { openDatabase } = require('../../../src/infrastructure/repositories/sqlite');
const { createSQLiteAuditRepository } = require('../../../src/infrastructure/repositories/sqlite-audit.repository');
const { createSQLiteFetchLog } = require('../../../src/infrastructure/repositories/sqlite-fetch-log');

function record(id, status, title, verifiedAt) {
  return {
    verificationId: id,
    status,
    eventReference: { source: 'google_calendar', sourceEventId: `evt-${id}`, fetchedAt: verifiedAt, sourceUpdatedAt: null },
    summary: { totalFields: 7, matchingFields: 6, mismatchingFields: 0, unverifiableFields: 1 },
    fieldResults: [{ field: 'title', official: title, draft: title, state: 'MATCH', explanation: 'x', correction: null, critical: true }],
    verifiedAt,
    requestId: `req-${id}`,
  };
}

const implementations = {
  memory: () => {
    const repo = createInMemoryAuditRepository({ maxRecords: 100 });
    return { repo, cleanup: async () => {} };
  },
  sqlite: () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sqlite-'));
    const file = path.join(dir, 'audit.db');
    const db = openDatabase(file, dir);
    const repo = createSQLiteAuditRepository({ db, logger: null });
    return {
      repo,
      db,
      file,
      cleanup: async () => {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  },
};

for (const [name, factory] of Object.entries(implementations)) {
  describe(`AuditRepository conformance (${name})`, () => {
    let ctx;
    beforeEach(() => {
      ctx = factory();
    });
    afterEach(async () => {
      await ctx.cleanup();
    });

    it('saves and replays records verbatim', async () => {
      const r = record('id-1', 'VERIFIED', 'Hacknite 2026', '2026-08-07T10:00:00.000Z');
      await ctx.repo.save(r);
      assert.deepEqual(await ctx.repo.getById('id-1'), r);
      assert.equal(await ctx.repo.getById('missing'), null);
    });

    it('lists with status filter, search, range, sort, and pagination', async () => {
      await ctx.repo.save(record('a', 'VERIFIED', 'Alpha Fest', '2026-01-01T00:00:00.000Z'));
      await ctx.repo.save(record('b', 'REVIEW_REQUIRED', 'Beta Night', '2026-02-01T00:00:00.000Z'));
      await ctx.repo.save(record('c', 'UNVERIFIABLE', 'Gamma Day', '2026-03-01T00:00:00.000Z'));

      const all = await ctx.repo.list({ page: 1, pageSize: 10 });
      assert.equal(all.total, 3);
      assert.equal(all.records[0].verificationId, 'c'); // desc default

      const asc = await ctx.repo.list({ page: 1, pageSize: 10, sort: 'asc' });
      assert.equal(asc.records[0].verificationId, 'a');

      const filtered = await ctx.repo.list({ status: 'REVIEW_REQUIRED', page: 1, pageSize: 10 });
      assert.deepEqual(filtered.records.map((r) => r.verificationId), ['b']);

      const searched = await ctx.repo.list({ q: 'beta', page: 1, pageSize: 10 });
      assert.deepEqual(searched.records.map((r) => r.verificationId), ['b']);

      const ranged = await ctx.repo.list({ from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z', page: 1, pageSize: 10 });
      assert.equal(ranged.total, 2);

      const page2 = await ctx.repo.list({ page: 2, pageSize: 2 });
      assert.equal(page2.total, 3);
      assert.equal(page2.records.length, 1);

      const beyond = await ctx.repo.list({ page: 9, pageSize: 10 });
      assert.deepEqual(beyond.records, []);
      assert.equal(beyond.total, 3);
    });

    it('computes genuine stats', async () => {
      assert.deepEqual(await ctx.repo.stats(), { total: 0, verified: 0, reviewRequired: 0, unverifiable: 0 });
      await ctx.repo.save(record('a', 'VERIFIED', 'A', '2026-01-01T00:00:00.000Z'));
      await ctx.repo.save(record('b', 'VERIFIED', 'B', '2026-01-02T00:00:00.000Z'));
      await ctx.repo.save(record('c', 'REVIEW_REQUIRED', 'C', '2026-01-03T00:00:00.000Z'));
      assert.deepEqual(await ctx.repo.stats(), { total: 3, verified: 2, reviewRequired: 1, unverifiable: 0 });
    });

    it('rejects saves without an id', async () => {
      await assert.rejects(() => ctx.repo.save({}), /verificationId/);
    });
  });
}

describe('SQLite durability', () => {
  it('survives close + reopen (restart persistence)', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sqlite-'));
    try {
      const file = path.join(dir, 'audit.db');
      const db1 = openDatabase(file, dir);
      const repo1 = createSQLiteAuditRepository({ db: db1, logger: null });
      await repo1.save(record('keep-me', 'VERIFIED', 'Durable Fest', '2026-01-01T00:00:00.000Z'));
      db1.close();

      // "Restart": fresh handle, migrations re-run idempotently.
      const db2 = openDatabase(file, dir);
      const repo2 = createSQLiteAuditRepository({ db: db2, logger: null });
      const found = await repo2.getById('keep-me');
      assert.equal(found.status, 'VERIFIED');
      assert.deepEqual(await repo2.stats(), { total: 1, verified: 1, reviewRequired: 0, unverifiable: 0 });
      db2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps storage failures to AUDIT_STORAGE_UNAVAILABLE (never silent)', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sqlite-'));
    try {
      const db = openDatabase(path.join(dir, 'audit.db'), dir);
      const repo = createSQLiteAuditRepository({ db, logger: null });
      db.close(); // sabotage: all further ops fail
      await assert.rejects(
        () => repo.save(record('x', 'VERIFIED', 'X', '2026-01-01T00:00:00.000Z')),
        (e) => e.code === 'AUDIT_STORAGE_UNAVAILABLE' && e.status === 503
      );
      await assert.rejects(() => repo.stats(), (e) => e.code === 'AUDIT_STORAGE_UNAVAILABLE');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses duplicate ids loudly', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sqlite-'));
    try {
      const db = openDatabase(path.join(dir, 'audit.db'), dir);
      const repo = createSQLiteAuditRepository({ db, logger: null });
      await repo.save(record('dup', 'VERIFIED', 'X', '2026-01-01T00:00:00.000Z'));
      await assert.rejects(
        () => repo.save(record('dup', 'VERIFIED', 'X', '2026-01-01T00:00:00.000Z')),
        (e) => e.code === 'AUDIT_STORAGE_UNAVAILABLE'
      );
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SQLite fetch log', () => {
  it('records outcomes and reports last success/failure', async () => {
    const dir = fs.mkdtempSync(path.join(__dirname, '.tmp-sqlite-'));
    try {
      const db = openDatabase(path.join(dir, 'audit.db'), dir);
      const fetchLog = createSQLiteFetchLog({ db });
      assert.deepEqual(await fetchLog.last(), {
        lastSuccessAt: null, lastFailureAt: null, lastErrorCategory: null, lastOutcomeAt: null,
      });
      await fetchLog.record({ outcome: 'failure', errorCategory: 'AUTH_REQUIRED', at: '2026-01-01T00:00:00.000Z' });
      await fetchLog.record({ outcome: 'success', at: '2026-01-02T00:00:00.000Z' });
      assert.deepEqual(await fetchLog.last(), {
        lastSuccessAt: '2026-01-02T00:00:00.000Z',
        lastFailureAt: '2026-01-01T00:00:00.000Z',
        lastErrorCategory: 'AUTH_REQUIRED',
        lastOutcomeAt: '2026-01-02T00:00:00.000Z',
      });
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
