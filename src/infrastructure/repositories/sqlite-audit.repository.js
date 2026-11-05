'use strict';

// SQLite-backed AuditRepository (durable Phase 2 history).
//
// Stores exactly the product evidence — ids, status, field results, event
// reference, timestamps — and no secrets (records never contain credentials).
// All storage failures surface as AUDIT_STORAGE_UNAVAILABLE (503); there is
// deliberately no silent in-memory fallback.

const { ServiceUnavailableError } = require('../../shared/errors/app-error');

function storageError(message, cause) {
  return new ServiceUnavailableError('AUDIT_STORAGE_UNAVAILABLE', message, cause ? { cause } : undefined);
}

function eventTitleOf(record) {
  const fields = Array.isArray(record.fieldResults) ? record.fieldResults : [];
  const title = fields.find((f) => f && f.field === 'title');
  if (!title) return null;
  return title.official ?? title.draft ?? null;
}

function toRow(record) {
  return {
    id: record.verificationId,
    status: record.status,
    source: record.eventReference.source,
    source_event_id: record.eventReference.sourceEventId,
    event_title: eventTitleOf(record),
    summary_json: JSON.stringify(record.summary),
    fields_json: JSON.stringify(record.fieldResults),
    event_ref_json: JSON.stringify(record.eventReference),
    verified_at: record.verifiedAt,
    request_id: record.requestId || null,
  };
}

function fromRow(row) {
  return {
    verificationId: row.id,
    status: row.status,
    eventReference: JSON.parse(row.event_ref_json),
    summary: JSON.parse(row.summary_json),
    fieldResults: JSON.parse(row.fields_json),
    verifiedAt: row.verified_at,
    requestId: row.request_id,
  };
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function createSQLiteAuditRepository({ db, logger }) {
  if (!db || typeof db.prepare !== 'function') {
    throw new Error('SQLiteAuditRepository requires an open DatabaseSync handle.');
  }
  const log = logger && logger.child ? logger.child({ component: 'sqlite-audit' }) : logger;

  async function save(record) {
    if (!record || typeof record.verificationId !== 'string') {
      throw new Error('AuditRepository.save requires a record with a verificationId.');
    }
    try {
      const row = toRow(record);
      db.prepare(
        `INSERT INTO verifications
         (id, status, source, source_event_id, event_title, summary_json, fields_json, event_ref_json, verified_at, request_id)
         VALUES (@id, @status, @source, @source_event_id, @event_title, @summary_json, @fields_json, @event_ref_json, @verified_at, @request_id)`
      ).run(row);
    } catch (err) {
      if (log) log.error('audit write failed', { verificationId: record.verificationId, err });
      throw storageError('The verification audit record could not be stored.', err);
    }
    return record;
  }

  async function getById(verificationId) {
    try {
      const row = db.prepare('SELECT * FROM verifications WHERE id = ?').get(verificationId);
      return row ? fromRow(row) : null;
    } catch (err) {
      throw storageError('The verification audit record could not be read.', err);
    }
  }

  async function list(query = {}) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const sort = query.sort === 'asc' ? 'ASC' : 'DESC';
    const where = [];
    const params = [];
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.q) {
      where.push('(id LIKE ? ESCAPE \'\\\' OR source_event_id LIKE ? ESCAPE \'\\\' OR event_title LIKE ? ESCAPE \'\\\')');
      const like = `%${escapeLike(query.q)}%`;
      params.push(like, like, like);
    }
    if (query.from) {
      where.push('verified_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('verified_at <= ?');
      params.push(query.to);
    }
    const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    try {
      const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM verifications ${filter}`).get(...params);
      const rows = db
        .prepare(
          `SELECT * FROM verifications ${filter} ORDER BY verified_at ${sort}, rowid ${sort} LIMIT ? OFFSET ?`
        )
        .all(...params, pageSize, (page - 1) * pageSize);
      return { records: rows.map(fromRow), total: totalRow.total };
    } catch (err) {
      throw storageError('Verification history could not be read.', err);
    }
  }

  async function stats() {
    try {
      const rows = db
        .prepare('SELECT status, COUNT(*) AS n FROM verifications GROUP BY status')
        .all();
      const out = { total: 0, verified: 0, reviewRequired: 0, unverifiable: 0 };
      for (const row of rows) {
        out.total += row.n;
        if (row.status === 'VERIFIED') out.verified = row.n;
        else if (row.status === 'REVIEW_REQUIRED') out.reviewRequired = row.n;
        else if (row.status === 'UNVERIFIABLE') out.unverifiable = row.n;
      }
      return out;
    } catch (err) {
      throw storageError('Verification statistics could not be read.', err);
    }
  }

  return { save, getById, list, stats };
}

module.exports = { createSQLiteAuditRepository };
