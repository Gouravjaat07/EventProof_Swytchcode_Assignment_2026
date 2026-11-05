'use strict';

// Deterministic verification engine. Compares a normalized OfficialEvent
// against a validated AnnouncementDraft and produces an explainable decision.
// No I/O, no clock, no external calls — fully testable with fixtures.
//
// Overall-status precedence (first match wins):
//   1. REVIEW_REQUIRED — a critical field MISMATCHes or is MISSING_IN_DRAFT.
//      A definite, actionable problem dominates every other consideration.
//   2. UNVERIFIABLE   — a critical field is MISSING_IN_SOURCE or UNVERIFIABLE.
//      The source cannot support a complete check of required fields.
//   3. REVIEW_REQUIRED — a non-critical field MISMATCHes.
//   4. VERIFIED       — every critical field MATCHes (or is NOT_APPLICABLE,
//      e.g. no time claimed for an all-day event / no venue on either side)
//      and no field MISMATCHes. Non-critical gaps never block VERIFIED.
//
// Fail-closed guards (INVARIANT 1/2/3/8):
//   - cancelled official events throw EVENT_CANCELLED (never VERIFIED).
//   - missing/invalid inputs throw VERIFICATION_FAILED (never VERIFIED).
//   - the engine never fetches, guesses, or repairs anything.

const { ConflictError, InternalServerError } = require('../../shared/errors/app-error');
const { APPLICATION } = require('../../config/application');
const { isCancelled } = require('../event/event.model');
const {
  STATES,
  buildVenueAliasLookup,
  compareTitle,
  compareVenue,
  compareTime,
  compareDate,
  compareTimeZone,
  compareRegistrationUrl,
} = require('./comparison');

const STATUSES = Object.freeze({
  VERIFIED: 'VERIFIED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  UNVERIFIABLE: 'UNVERIFIABLE',
  INVALID_INPUT: 'INVALID_INPUT',
});

function failed(message) {
  return new InternalServerError('VERIFICATION_FAILED', message);
}

function verify(official, draft, options = {}) {
  if (!official || typeof official !== 'object' || Array.isArray(official)) {
    throw failed('Verification requires an official event record.');
  }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    throw failed('Verification requires an announcement draft.');
  }
  if (isCancelled(official)) {
    throw new ConflictError(
      'EVENT_CANCELLED',
      'The official event is cancelled; it cannot be verified for publication.'
    );
  }

  const criticalSet = new Set(APPLICATION.criticalFields);
  const isCritical = (field) => criticalSet.has(field);
  const aliasLookup = buildVenueAliasLookup(options.venueAliases);
  const allDay = official.allDay === true;
  const tzSource = official.timeZoneSource || null;

  const fieldResults = [
    compareTitle(official.title ?? null, draft.title ?? null, isCritical('title')),
    compareDate(official.startDate ?? null, draft.eventDate ?? null, isCritical('eventDate'), tzSource),
    compareTime({
      field: 'startTime', label: 'Start time',
      officialTime: official.startTime ?? null, draftTime: draft.startTime ?? null,
      critical: isCritical('startTime'), allDay, timeZoneSource: tzSource,
      instantMs: official.startInstantMs ?? null, draftTimeZone: draft.timeZone ?? null,
    }),
    compareTime({
      field: 'endTime', label: 'End time',
      officialTime: official.endTime ?? null, draftTime: draft.endTime ?? null,
      critical: isCritical('endTime'), allDay, timeZoneSource: tzSource,
      instantMs: official.endInstantMs ?? null, draftTimeZone: draft.timeZone ?? null,
    }),
    compareTimeZone(official.timeZone ?? null, draft.timeZone ?? null, isCritical('timeZone'), allDay, tzSource),
    compareVenue(official.location ?? null, draft.venue ?? null, isCritical('venue'), aliasLookup),
    compareRegistrationUrl(
      official.registrationUrl ?? null, draft.registrationUrl ?? null, isCritical('registrationUrl')
    ),
  ];

  const status = decideStatus(fieldResults);
  const matchingFields = fieldResults.filter((f) => f.state === STATES.MATCH).length;
  const mismatchingFields = fieldResults.filter((f) => f.state === STATES.MISMATCH).length;
  const summary = Object.freeze({
    totalFields: fieldResults.length,
    matchingFields,
    mismatchingFields,
    unverifiableFields: fieldResults.length - matchingFields - mismatchingFields,
  });

  return Object.freeze({ status, fieldResults: Object.freeze(fieldResults), summary });
}

function decideStatus(fieldResults) {
  const critical = fieldResults.filter((f) => f.critical);
  const nonCritical = fieldResults.filter((f) => !f.critical);

  const criticalMismatchOrMissingDraft = critical.some(
    (f) => f.state === STATES.MISMATCH || f.state === STATES.MISSING_IN_DRAFT
  );
  if (criticalMismatchOrMissingDraft) return STATUSES.REVIEW_REQUIRED;

  const criticalUnverifiable = critical.some(
    (f) => f.state === STATES.MISSING_IN_SOURCE || f.state === STATES.UNVERIFIABLE
  );
  if (criticalUnverifiable) return STATUSES.UNVERIFIABLE;

  const nonCriticalMismatch = nonCritical.some((f) => f.state === STATES.MISMATCH);
  if (nonCriticalMismatch) return STATUSES.REVIEW_REQUIRED;

  return STATUSES.VERIFIED;
}

module.exports = { verify, STATUSES };
