'use strict';

// AnnouncementDraft: validated organizer input.
//
// Field requirements:
//  - title: required, non-empty string, max 300 chars.
//  - eventDate: required, strict "YYYY-MM-DD" naming a real calendar date.
//  - startTime: optional time ("HH:MM" or "h:MM AM/PM"); null when omitted.
//  - endTime: optional time; when both times are present they must differ.
//    Overnight intervals (end earlier than start) are accepted and flagged —
//    a campus event can legitimately run past midnight. Zero-length
//    intervals (end == start) are rejected as INVALID_TIME.
//  - timeZone: optional IANA name; accepted when Intl accepts it. Null when
//    omitted (the engine then interprets draft times in the official zone and
//    reports timeZone as MISSING_IN_DRAFT, non-critical).
//  - venue: optional string, max 500 chars; blank normalizes to null.
//  - registrationUrl: optional URL. Must be http(s), include a hostname,
//    contain no embedded credentials, and be at most 2048 chars. Normalized
//    deterministically via WHATWG URL (lowercased host, default ports
//    dropped). The URL is validated, never fetched.
//  - description: optional string, max 5000 chars; accepted and ignored by
//    the comparison (no authoritative counterpart to check it against).
//
// Unknown fields are stripped (forward-compatible input). Types are never
// coerced: a number where a string belongs is INVALID_REQUEST.

const { ValidationError } = require('../../shared/errors/app-error');
const { normalizeText } = require('../text/normalize');
const { parseDateOnly, parseTimeValue, isValidTimeZone } = require('../time/datetime');

const MAX_TITLE_LENGTH = 300;
const MAX_VENUE_LENGTH = 500;
const MAX_URL_LENGTH = 2048;
const MAX_DESCRIPTION_LENGTH = 5000;

function missing(field) {
  return new ValidationError('MISSING_REQUIRED_FIELD', `Missing required field: "${field}".`, {
    details: { field },
  });
}

function badRequest(field, message) {
  return new ValidationError('INVALID_REQUEST', message, { details: { field } });
}

function requireString(input, field, maxLen) {
  const value = input[field];
  if (typeof value !== 'string') {
    throw badRequest(field, `Field "${field}" must be a string.`);
  }
  if (value.length > maxLen) {
    throw badRequest(field, `Field "${field}" exceeds ${maxLen} characters.`);
  }
  return value;
}

function optionalString(input, field, maxLen) {
  const value = input[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw badRequest(field, `Field "${field}" must be a string.`);
  }
  if (value.length > maxLen) {
    throw badRequest(field, `Field "${field}" exceeds ${maxLen} characters.`);
  }
  return value;
}

function normalizeRegistrationUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(
      'INVALID_REGISTRATION_URL',
      'Field "registrationUrl" is not a valid URL.',
      { details: { field: 'registrationUrl' } }
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError(
      'INVALID_REGISTRATION_URL',
      'Field "registrationUrl" must use http or https.',
      { details: { field: 'registrationUrl' } }
    );
  }
  if (!url.hostname) {
    throw new ValidationError(
      'INVALID_REGISTRATION_URL',
      'Field "registrationUrl" must include a hostname.',
      { details: { field: 'registrationUrl' } }
    );
  }
  if (url.username || url.password) {
    throw new ValidationError(
      'INVALID_REGISTRATION_URL',
      'Field "registrationUrl" must not embed credentials.',
      { details: { field: 'registrationUrl' } }
    );
  }
  return url.href;
}

function validateAnnouncementDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('INVALID_REQUEST', 'Field "announcement" must be an object.', {
      details: { field: 'announcement' },
    });
  }

  if (input.title === undefined || input.title === null || input.title === '') {
    throw missing('title');
  }
  const titleRaw = requireString(input, 'title', MAX_TITLE_LENGTH);
  const title = normalizeText(titleRaw);
  if (title === null) throw missing('title');

  if (input.eventDate === undefined || input.eventDate === null || input.eventDate === '') {
    throw missing('eventDate');
  }
  requireString(input, 'eventDate', 32);
  const eventDate = parseDateOnly(input.eventDate);
  if (!eventDate) {
    throw new ValidationError(
      'INVALID_DATE',
      'Field "eventDate" must be a real calendar date in "YYYY-MM-DD" format.',
      { details: { field: 'eventDate' } }
    );
  }

  const startRaw = optionalString(input, 'startTime', 32);
  let startTime = null;
  if (startRaw !== null) {
    startTime = parseTimeValue(startRaw);
    if (!startTime) {
      throw new ValidationError(
        'INVALID_TIME',
        'Field "startTime" must be "HH:MM" (24-hour) or "h:MM AM/PM".',
        { details: { field: 'startTime' } }
      );
    }
  }

  const endRaw = optionalString(input, 'endTime', 32);
  let endTime = null;
  if (endRaw !== null) {
    endTime = parseTimeValue(endRaw);
    if (!endTime) {
      throw new ValidationError(
        'INVALID_TIME',
        'Field "endTime" must be "HH:MM" (24-hour) or "h:MM AM/PM".',
        { details: { field: 'endTime' } }
      );
    }
  }
  if (startTime !== null && endTime !== null && startTime === endTime) {
    throw new ValidationError(
      'INVALID_TIME',
      'Fields "startTime" and "endTime" must differ (zero-length intervals are rejected).',
      { details: { field: 'endTime' } }
    );
  }
  const overnight = startTime !== null && endTime !== null && endTime < startTime;

  const tzRaw = optionalString(input, 'timeZone', 128);
  let timeZone = null;
  if (tzRaw !== null) {
    if (!isValidTimeZone(tzRaw)) {
      throw new ValidationError(
        'INVALID_TIMEZONE',
        'Field "timeZone" must be a valid IANA time-zone name (e.g. "Asia/Kolkata").',
        { details: { field: 'timeZone' } }
      );
    }
    timeZone = tzRaw;
  }

  const venueRaw = optionalString(input, 'venue', MAX_VENUE_LENGTH);
  const venue = venueRaw === null ? null : normalizeText(venueRaw);

  const urlRaw = optionalString(input, 'registrationUrl', MAX_URL_LENGTH);
  const registrationUrl = urlRaw === null ? null : normalizeRegistrationUrl(urlRaw);

  const descRaw = optionalString(input, 'description', MAX_DESCRIPTION_LENGTH);
  const description = descRaw === null ? null : normalizeText(descRaw);

  return Object.freeze({
    title,
    eventDate,
    startTime,
    endTime,
    overnight,
    timeZone,
    venue,
    registrationUrl,
    description,
  });
}

module.exports = { validateAnnouncementDraft };
