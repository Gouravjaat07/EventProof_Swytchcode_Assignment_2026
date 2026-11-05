'use strict';

// HistoryService: validated read access to verification history + dashboard
// aggregates. All numbers come from the audit repository — never hardcoded,
// never guessed.

const { ValidationError } = require('../../shared/errors/app-error');

const STATUSES = ['VERIFIED', 'REVIEW_REQUIRED', 'UNVERIFIABLE'];
const MAX_QUERY_LENGTH = 256;
const MAX_PAGE_SIZE = 100;

function invalid(field, message, code = 'INVALID_REQUEST') {
  return new ValidationError(code, message, { details: { field } });
}

function parsePositiveInt(value, field, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+$/.test(text)) {
    throw invalid(field, `Field "${field}" must be an integer.`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) {
    throw invalid(field, `Field "${field}" must be an integer between 1 and ${max}.`);
  }
  return n;
}

function parseInstant(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ValidationError('INVALID_DATE', `Field "${field}" must be a valid ISO-8601 date-time.`, {
      details: { field },
    });
  }
  return new Date(value).toISOString();
}

function createHistoryService({ auditRepository, logger }) {
  if (!auditRepository || typeof auditRepository.list !== 'function' || typeof auditRepository.stats !== 'function') {
    throw new Error('HistoryService requires an AuditRepository with list/stats.');
  }
  const log = logger && logger.child ? logger.child({ service: 'history' }) : logger;

  async function listVerifications(input = {}) {
    const status = input.status === undefined || input.status === null || input.status === ''
      ? undefined
      : input.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      throw invalid('status', `Field "status" must be one of: ${STATUSES.join(', ')}.`);
    }
    const q = input.q === undefined || input.q === null || input.q === '' ? undefined : input.q;
    if (q !== undefined && (typeof q !== 'string' || q.length > MAX_QUERY_LENGTH)) {
      throw invalid('q', `Field "q" must be a string of at most ${MAX_QUERY_LENGTH} characters.`);
    }
    const from = parseInstant(input.from, 'from');
    const to = parseInstant(input.to, 'to');
    if (from && to && from > to) {
      throw new ValidationError('INVALID_DATE', 'Field "from" must not be after "to".', {
        details: { field: 'from' },
      });
    }
    const sort = input.sort === undefined || input.sort === null || input.sort === '' ? 'desc' : input.sort;
    if (sort !== 'asc' && sort !== 'desc') {
      throw invalid('sort', 'Field "sort" must be "asc" or "desc".');
    }
    const page = parsePositiveInt(input.page, 'page', 1, 1000000);
    const pageSize = parsePositiveInt(input.pageSize, 'pageSize', 20, MAX_PAGE_SIZE);

    const { records, total } = await auditRepository.list({ status, q, from, to, page, pageSize, sort });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (log) log.debug('history listed', { total, page, pageSize });
    return { records, page, pageSize, total, totalPages };
  }

  async function getStats() {
    return auditRepository.stats();
  }

  return { listVerifications, getStats };
}

module.exports = { createHistoryService, STATUSES, MAX_PAGE_SIZE };
