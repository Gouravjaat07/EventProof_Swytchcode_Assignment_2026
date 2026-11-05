'use strict';

// In-memory AuditRepository for development and Phase 1.
//
// - Capacity-bounded FIFO (oldest records evicted past maxRecords).
// - Records are deep-cloned on write AND read, so callers can never mutate
//   stored evidence and one request's data can never leak into another's.
// - Records DO NOT survive process restarts. This is an explicit,
//   documented limitation: swap in a persistent AuditRepository (same port)
//   when durability is required.

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInMemoryAuditRepository({ maxRecords = 500 } = {}) {
  const store = new Map();

  async function save(record) {
    if (!record || typeof record.verificationId !== 'string') {
      throw new Error('AuditRepository.save requires a record with a verificationId.');
    }
    store.set(record.verificationId, clone(record));
    while (store.size > maxRecords) {
      const oldest = store.keys().next().value;
      store.delete(oldest);
    }
    return clone(record);
  }

  async function getById(verificationId) {
    const found = store.get(verificationId);
    return found === undefined ? null : clone(found);
  }

  function matches(record, query) {
    if (query.status && record.status !== query.status) return false;
    if (query.q) {
      const needle = query.q.toLowerCase();
      const titleField = (record.fieldResults || []).find((f) => f && f.field === 'title') || {};
      const hay = `${record.verificationId} ${record.eventReference.sourceEventId} ${titleField.official || ''} ${titleField.draft || ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (query.from && record.verifiedAt < query.from) return false;
    if (query.to && record.verifiedAt > query.to) return false;
    return true;
  }

  async function list(query = {}) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const dir = query.sort === 'asc' ? 1 : -1;
    const filtered = [...store.values()]
      .filter((r) => matches(r, query))
      .sort((a, b) => (a.verifiedAt < b.verifiedAt ? -dir : a.verifiedAt > b.verifiedAt ? dir : 0));
    const total = filtered.length;
    const records = filtered.slice((page - 1) * pageSize, page * pageSize).map(clone);
    return { records, total };
  }

  async function stats() {
    const out = { total: 0, verified: 0, reviewRequired: 0, unverifiable: 0 };
    for (const record of store.values()) {
      out.total += 1;
      if (record.status === 'VERIFIED') out.verified += 1;
      else if (record.status === 'REVIEW_REQUIRED') out.reviewRequired += 1;
      else if (record.status === 'UNVERIFIABLE') out.unverifiable += 1;
    }
    return out;
  }

  async function count() {
    return store.size;
  }

  return { save, getById, list, stats, count };
}

module.exports = { createInMemoryAuditRepository };
