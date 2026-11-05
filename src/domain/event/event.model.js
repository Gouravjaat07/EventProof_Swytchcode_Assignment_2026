'use strict';

// OfficialEvent: normalized internal model for one authoritative calendar event.
//
// Source shape: Google Calendar API v3 `Event` resource (as returned inside
// `events.list` → `items[]`):
//   { id, status, summary, description, location, start: {date|dateTime,timeZone},
//     end: {...}, updated, htmlLink, ... }
//
// Mapping rules:
//  - `id` is required; a missing id makes the record unusable (invalid).
//  - `status` is preserved verbatim; absence yields null (never invented).
//  - Timed events carry dateTime; all-day events carry date (end.date is
//    EXCLUSIVE per Google semantics — kept as-is for evidence, comparisons use
//    startDate/startTime/endTime as documented in the engine).
//  - Wall-clock rendering always happens in the event's own time zone:
//    start.timeZone → calendar fallback (caller-provided) → "UTC". The
//    provenance is recorded in `timeZoneSource` so a UTC fallback is visible
//    in explanations instead of silently assumed.
//  - Nothing is thrown for *missing* optional content (title/location/…);
//    absence is data the engine reports (MISSING_IN_SOURCE). Only structural
//    corruption (bad types, unparseable timestamps) throws, as
//    SWYTCHCODE_INVALID_RESPONSE, because it describes upstream data, not
//    user input.

const { ExternalIntegrationError } = require('../../shared/errors/app-error');
const { normalizeText } = require('../text/normalize');
const { parseDateOnly, parseTimeValue, parseRfc3339, renderInTimeZone, isValidTimeZone } = require('../time/datetime');

const MAX_DESCRIPTION_LENGTH = 2000;

function invalidResponse(message, details) {
  return new ExternalIntegrationError('SWYTCHCODE_INVALID_RESPONSE', message, details ? { details } : undefined);
}

function asOptionalText(raw, field) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw invalidResponse(`Upstream event has a non-string "${field}".`, { field });
  }
  return normalizeText(raw);
}

function pickTimeZone(explicit, calendarFallback) {
  if (typeof explicit === 'string' && isValidTimeZone(explicit)) {
    return { timeZone: explicit, source: 'event' };
  }
  if (typeof calendarFallback === 'string' && isValidTimeZone(calendarFallback)) {
    return { timeZone: calendarFallback, source: 'calendar' };
  }
  return { timeZone: 'UTC', source: 'utc-fallback' };
}

const HAS_OFFSET_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;
const FLOATING_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d{1,9})?)?$/;

// Parses one Google dateTime field into { date, time, instantMs }.
function parseDateTimeField(value, field, timeZone) {
  const text = value.trim();
  if (!HAS_OFFSET_RE.test(text)) {
    const m = FLOATING_RE.exec(text);
    const date = m ? parseDateOnly(m[1]) : null;
    const time = m ? parseTimeValue(m[2]) : null;
    if (!date || !time) throw invalidResponse(`Upstream event has an invalid floating "${field}".`, { field });
    return { date, time, instantMs: null };
  }
  const ms = parseRfc3339(text);
  if (ms === null) throw invalidResponse(`Upstream event has an unparseable "${field}".`, { field });
  const rendered = renderInTimeZone(ms, timeZone);
  if (!rendered) throw invalidResponse(`Upstream event "${field}" could not be rendered.`, { field });
  return { date: rendered.date, time: rendered.time, instantMs: ms };
}

// Normalizes one Google Calendar API v3 Event into an OfficialEvent.
// `options.calendarTimeZone` should carry events.list's top-level `timeZone`.
function normalizeOfficialEvent(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidResponse('Upstream event is not an object.');
  }
  if (typeof raw.id !== 'string' || raw.id.trim() === '') {
    throw invalidResponse('Upstream event is missing its "id".');
  }

  const start = raw.start && typeof raw.start === 'object' ? raw.start : null;
  const end = raw.end && typeof raw.end === 'object' ? raw.end : null;
  if (!start) throw invalidResponse('Upstream event is missing its "start".', { field: 'start' });

  const allDay = typeof start.date === 'string';
  let startDate = null;
  let startTime = null;
  let endDate = null;
  let endTime = null;
  let timeZone = null;
  let timeZoneSource = null;
  // Absolute instants (ms). Null for all-day events and for floating
  // dateTimes without an offset. The engine uses them to re-render times in
  // the draft's frame when the official zone had to fall back to UTC.
  let startInstantMs = null;
  let endInstantMs = null;

  if (allDay) {
    startDate = parseDateOnly(start.date);
    if (!startDate) throw invalidResponse('Upstream event has an invalid all-day start date.', { field: 'start.date' });
    // end.date is exclusive per Google; absence means a one-day event.
    if (end && typeof end.date === 'string') {
      endDate = parseDateOnly(end.date);
      if (!endDate) throw invalidResponse('Upstream event has an invalid all-day end date.', { field: 'end.date' });
    } else {
      endDate = startDate;
    }
  } else {
    if (typeof start.dateTime !== 'string') {
      throw invalidResponse('Upstream timed event is missing "start.dateTime".', { field: 'start.dateTime' });
    }
    const picked = pickTimeZone(start.timeZone, options.calendarTimeZone);
    timeZone = picked.timeZone;
    timeZoneSource = picked.source;
    // A dateTime WITH an offset (or Z) names an exact instant: parse and
    // render it in the event zone. A "floating" dateTime (no offset) names a
    // wall time directly (Google interprets it in the calendar's zone), so its
    // literal date/time are used verbatim — parsing it as UTC would shift it.
    const startParsed = parseDateTimeField(start.dateTime, 'start.dateTime', timeZone);
    startDate = startParsed.date;
    startTime = startParsed.time;
    startInstantMs = startParsed.instantMs;

    if (end && typeof end.dateTime === 'string') {
      const endParsed = parseDateTimeField(end.dateTime, 'end.dateTime', timeZone);
      endDate = endParsed.date;
      endTime = endParsed.time;
      endInstantMs = endParsed.instantMs;
    } else if (end && typeof end.date === 'string') {
      // Mixed all-day end on a timed start: keep the date, no end time.
      endDate = parseDateOnly(end.date);
      if (!endDate) throw invalidResponse('Upstream event has an invalid end date.', { field: 'end.date' });
    }
    // else: no usable end — endDate/endTime stay null (reported, never guessed).
  }

  const description = asOptionalText(raw.description, 'description');
  const event = {
    id: raw.id,
    source: options.source || 'google_calendar',
    sourceEventId: raw.id,
    title: asOptionalText(raw.summary, 'summary'),
    description: description ? description.slice(0, MAX_DESCRIPTION_LENGTH) : null,
    startDate,
    endDate,
    startTime,
    endTime,
    startInstantMs,
    endInstantMs,
    timeZone,
    timeZoneSource,
    allDay,
    location: asOptionalText(raw.location, 'location'),
    status: typeof raw.status === 'string' ? raw.status : null,
    sourceUpdatedAt: typeof raw.updated === 'string' && parseRfc3339(raw.updated) !== null ? raw.updated : null,
    fetchedAt: options.fetchedAt || new Date().toISOString(),
    sourceReference: Object.freeze({
      calendarId: options.calendarId || null,
      htmlLink: typeof raw.htmlLink === 'string' ? raw.htmlLink : null,
    }),
  };
  return Object.freeze(event);
}

function isCancelled(event) {
  return !!event && event.status === 'cancelled';
}

module.exports = { normalizeOfficialEvent, isCancelled };
