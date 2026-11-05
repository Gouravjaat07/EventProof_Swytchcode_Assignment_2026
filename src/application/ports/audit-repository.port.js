'use strict';

// AuditRepository port: persists verification evidence. The Phase 1
// implementation is in-memory (see infrastructure/repositories); records do
// NOT survive process restarts. A future persistent implementation (PostgreSQL,
// …) implements this same interface.
//
// save(record) -> Promise<stored record>
//   record: { verificationId, status, eventReference, summary, fieldResults,
//             verifiedAt, requestId? }. Implementations must not mutate it.
// getById(verificationId) -> Promise<record|null>
// list(query) -> Promise<{ records, total }>
//   query: { status?, q?, from?, to?, page?, pageSize?, sort? } (validated by
//   the caller; page is 1-based, sort is "asc"|"desc" on verified time).
// stats() -> Promise<{ total, verified, reviewRequired, unverifiable }>

class AuditRepository {
  async save() {
    throw new Error('AuditRepository.save is not implemented.');
  }

  async getById() {
    throw new Error('AuditRepository.getById is not implemented.');
  }

  async list() {
    throw new Error('AuditRepository.list is not implemented.');
  }

  async stats() {
    throw new Error('AuditRepository.stats is not implemented.');
  }
}

module.exports = { AuditRepository };
