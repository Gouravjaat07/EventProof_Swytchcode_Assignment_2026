'use strict';

// VerificationResult: stable, serializable verification contract.
//
// {
//   verificationId: "uuid",
//   status: "VERIFIED" | "REVIEW_REQUIRED" | "UNVERIFIABLE" | "INVALID_INPUT",
//   eventReference: { source, sourceEventId, fetchedAt, sourceUpdatedAt },
//   summary: { totalFields, matchingFields, mismatchingFields, unverifiableFields },
//   fieldResults: [ FieldResult, ... ],
//   verifiedAt: "ISO-8601"
// }
//
// The builder validates its inputs defensively so a malformed engine output
// can never leave the service as a trusted result.

const { InternalServerError } = require('../../shared/errors/app-error');
const { STATUSES } = require('./engine');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failed(message) {
  return new InternalServerError('VERIFICATION_FAILED', message);
}

function buildVerificationResult(input) {
  if (!input || typeof input !== 'object') throw failed('Verification result input must be an object.');
  const { verificationId, status, eventReference, fieldResults, summary, verifiedAt } = input;

  if (typeof verificationId !== 'string' || !UUID_RE.test(verificationId)) {
    throw failed('Verification result requires a valid verificationId.');
  }
  if (!Object.values(STATUSES).includes(status)) throw failed('Verification result has an unknown status.');
  if (!eventReference || typeof eventReference.source !== 'string' || typeof eventReference.sourceEventId !== 'string') {
    throw failed('Verification result requires an event reference with source and sourceEventId.');
  }
  if (!Array.isArray(fieldResults) || fieldResults.length === 0) {
    throw failed('Verification result requires at least one field result.');
  }
  if (!summary || typeof summary !== 'object') throw failed('Verification result requires a summary.');
  if (typeof verifiedAt !== 'string' || !Number.isFinite(Date.parse(verifiedAt))) {
    throw failed('Verification result requires a valid verifiedAt timestamp.');
  }

  return Object.freeze({
    verificationId,
    status,
    eventReference: Object.freeze({
      source: eventReference.source,
      sourceEventId: eventReference.sourceEventId,
      fetchedAt: eventReference.fetchedAt ?? null,
      sourceUpdatedAt: eventReference.sourceUpdatedAt ?? null,
    }),
    summary: Object.freeze({ ...summary }),
    fieldResults: Object.freeze(fieldResults.map((f) => Object.freeze({ ...f }))),
    verifiedAt,
  });
}

module.exports = { buildVerificationResult };
