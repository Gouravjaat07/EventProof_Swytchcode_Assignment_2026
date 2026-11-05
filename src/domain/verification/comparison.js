'use strict';

// Field-level comparison primitives for the verification engine.
// Pure functions: same inputs always produce the same FieldResult.
//
// Every result carries:
//   field, official (original official value), draft (original draft value),
//   state, explanation (human-readable), correction (official value to fix the
//   draft with, or null), critical (whether MATCH is required for VERIFIED).
//
// State meanings:
//   MATCH            — values are equivalent under documented normalization.
//   MISMATCH         — both sides present and verifiably different.
//   MISSING_IN_DRAFT — official record has it, the draft omits it.
//   MISSING_IN_SOURCE— the draft claims it, the official record lacks it.
//   UNVERIFIABLE     — a comparison is impossible (e.g. draft claims a time
//                      for an all-day event, or no authoritative counterpart
//                      exists at all).
//   NOT_APPLICABLE   — neither side has the field and it is optional.

const {
  normalizeTitleForCompare,
  normalizeVenueForCompare,
  buildVenueAliasLookup,
} = require('../text/normalize');
const { canonicalTimeZone, renderInTimeZone } = require('../time/datetime');

const STATES = Object.freeze({
  MATCH: 'MATCH',
  MISMATCH: 'MISMATCH',
  MISSING_IN_DRAFT: 'MISSING_IN_DRAFT',
  MISSING_IN_SOURCE: 'MISSING_IN_SOURCE',
  UNVERIFIABLE: 'UNVERIFIABLE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

function fieldResult(field, official, draft, state, explanation, critical, correction = null) {
  return Object.freeze({ field, official, draft, state, explanation, correction, critical });
}

// Generic optional-field comparison when both sides are already normalized
// strings (or null) and plain equality decides.
function compareOptionalText({ field, label, official, draft, critical, required = false, equals = (a, b) => a === b }) {
  if (official === null && draft === null) {
    if (required) {
      return fieldResult(field, null, null, STATES.UNVERIFIABLE, `${label} is absent from both the official record and the draft.`, critical);
    }
    return fieldResult(field, null, null, STATES.NOT_APPLICABLE, `Neither the official record nor the draft provides ${label.toLowerCase()}.`, critical);
  }
  if (official === null) {
    return fieldResult(field, null, draft, STATES.MISSING_IN_SOURCE, `The draft provides ${label.toLowerCase()} but the official record does not.`, critical);
  }
  if (draft === null) {
    return fieldResult(field, official, null, STATES.MISSING_IN_DRAFT, `The draft omits ${label.toLowerCase()} present in the official record.`, critical, official);
  }
  if (equals(official, draft)) {
    return fieldResult(field, official, draft, STATES.MATCH, `${label} matches the official event record.`, critical);
  }
  return fieldResult(field, official, draft, STATES.MISMATCH, `The announcement ${label.toLowerCase()} differs from the official event record.`, critical, official);
}

function compareTitle(officialTitle, draftTitle, critical) {
  if (officialTitle === null && draftTitle === null) {
    return fieldResult('title', null, null, STATES.UNVERIFIABLE, 'Title is absent from both the official record and the draft.', critical);
  }
  if (officialTitle === null) {
    return fieldResult('title', null, draftTitle, STATES.MISSING_IN_SOURCE, 'The draft provides a title but the official record has none.', critical);
  }
  if (draftTitle === null) {
    return fieldResult('title', officialTitle, null, STATES.MISSING_IN_DRAFT, 'The draft omits the event title.', critical, officialTitle);
  }
  const officialKey = normalizeTitleForCompare(officialTitle);
  const draftKey = normalizeTitleForCompare(draftTitle);
  if (officialKey !== null && officialKey === draftKey) {
    return fieldResult('title', officialTitle, draftTitle, STATES.MATCH, 'Title matches the official event record.', critical);
  }
  return fieldResult('title', officialTitle, draftTitle, STATES.MISMATCH, 'The announcement title differs from the official event record.', critical, officialTitle);
}

function compareVenue(officialVenue, draftVenue, critical, aliasLookup) {
  if (officialVenue === null && draftVenue === null) {
    return fieldResult('venue', null, null, STATES.NOT_APPLICABLE, 'Neither the official record nor the draft provides a venue.', critical);
  }
  if (officialVenue === null) {
    return fieldResult('venue', null, draftVenue, STATES.MISSING_IN_SOURCE, 'The draft provides a venue but the official record has none.', critical);
  }
  if (draftVenue === null) {
    return fieldResult('venue', officialVenue, null, STATES.MISSING_IN_DRAFT, 'The draft omits the venue present in the official record.', critical, officialVenue);
  }
  const o = normalizeVenueForCompare(officialVenue, aliasLookup);
  const d = normalizeVenueForCompare(draftVenue, aliasLookup);
  if (o.key !== null && o.key === d.key) {
    const viaAlias = o.aliasUsed || d.aliasUsed;
    return fieldResult(
      'venue', officialVenue, draftVenue, STATES.MATCH,
      viaAlias ? 'Venue matches the official event record via a configured alias.' : 'Venue matches the official event record.',
      critical
    );
  }
  return fieldResult('venue', officialVenue, draftVenue, STATES.MISMATCH, 'The announcement venue differs from the official event record.', critical, officialVenue);
}

// Time comparison for one of startTime/endTime. `official` carries the
// rendered wall time plus provenance; `instantMs` lets a UTC-fallback value be
// re-rendered in the draft's frame when the instant is actually known.
function compareTime({ field, label, officialTime, draftTime, critical, allDay, timeZoneSource, instantMs, draftTimeZone }) {
  if (officialTime === null && draftTime === null) {
    return fieldResult(field, null, null, STATES.NOT_APPLICABLE, `Neither the official record nor the draft provides ${label}.`, critical);
  }
  if (allDay && draftTime !== null) {
    return fieldResult(field, null, draftTime, STATES.UNVERIFIABLE, `The official event is all-day, so ${label} cannot be verified against it.`, critical);
  }
  if (officialTime === null) {
    return fieldResult(field, null, draftTime, STATES.MISSING_IN_SOURCE, `The draft provides ${label} but the official record does not.`, critical);
  }
  if (draftTime === null) {
    return fieldResult(field, officialTime, null, STATES.MISSING_IN_DRAFT, `The draft omits ${label} present in the official record.`, critical, officialTime);
  }
  if (timeZoneSource === 'utc-fallback') {
    // The wall time was rendered in UTC as a last resort; comparing it
    // against the draft's wall time would manufacture mismatches. When the
    // instant is known (dateTime carried an offset) and the draft names its
    // zone, re-render in the draft's frame — otherwise stay unverifiable.
    const draftZone = canonicalTimeZone(draftTimeZone);
    if (draftZone && Number.isFinite(instantMs)) {
      const rendered = renderInTimeZone(instantMs, draftZone);
      if (rendered && rendered.time === draftTime) {
        return fieldResult(field, rendered.time, draftTime, STATES.MATCH, `${label} matches the official event record when compared in the draft's time zone (official zone unknown).`, critical);
      }
      if (rendered) {
        return fieldResult(field, rendered.time, draftTime, STATES.MISMATCH, `The announcement ${label} differs from the official event record when compared in the draft's time zone (official zone unknown).`, critical, rendered.time);
      }
    }
    return fieldResult(field, officialTime, draftTime, STATES.UNVERIFIABLE, `The official time zone is unknown, so ${label} cannot be reliably compared.`, critical);
  }
  if (officialTime === draftTime) {
    return fieldResult(field, officialTime, draftTime, STATES.MATCH, `${label} matches the official event record.`, critical);
  }
  return fieldResult(field, officialTime, draftTime, STATES.MISMATCH, `The announcement ${label} differs from the official event record.`, critical, officialTime);
}

function compareDate(officialDate, draftDate, critical, timeZoneSource) {
  if (timeZoneSource === 'utc-fallback' && officialDate !== null && draftDate !== null) {
    return fieldResult('eventDate', officialDate, draftDate, STATES.UNVERIFIABLE, 'The official time zone is unknown, so the event date cannot be reliably compared.', critical);
  }
  return compareOptionalText({
    field: 'eventDate', label: 'Event date', official: officialDate, draft: draftDate, critical, required: true,
  });
}

function compareTimeZone(officialZone, draftZone, critical, allDay, timeZoneSource) {
  if (allDay) {
    return fieldResult('timeZone', null, draftZone, STATES.NOT_APPLICABLE, 'The official event is all-day; time zone does not apply.', critical);
  }
  if (timeZoneSource === 'utc-fallback') {
    if (draftZone === null) {
      return fieldResult('timeZone', null, null, STATES.NOT_APPLICABLE, 'Neither side provides a verifiable time zone.', critical);
    }
    return fieldResult('timeZone', null, draftZone, STATES.UNVERIFIABLE, 'The official time zone is unknown, so it cannot be verified.', critical);
  }
  if (officialZone === null && draftZone === null) {
    return fieldResult('timeZone', null, null, STATES.NOT_APPLICABLE, 'Neither the official record nor the draft provides a time zone.', critical);
  }
  if (officialZone === null) {
    return fieldResult('timeZone', null, draftZone, STATES.MISSING_IN_SOURCE, 'The draft provides a time zone but the official record has none.', critical);
  }
  if (draftZone === null) {
    return fieldResult('timeZone', officialZone, null, STATES.MISSING_IN_DRAFT, 'The draft omits the time zone; draft times were interpreted in the official zone.', critical, officialZone);
  }
  const o = canonicalTimeZone(officialZone);
  const d = canonicalTimeZone(draftZone);
  if (o !== null && o === d) {
    return fieldResult('timeZone', officialZone, draftZone, STATES.MATCH, 'Time zone matches the official event record.', critical);
  }
  return fieldResult('timeZone', officialZone, draftZone, STATES.MISMATCH, 'The announcement time zone differs from the official event record.', critical, officialZone);
}

// Google Calendar events carry no authoritative registration URL, so the
// official side is always null today. The comparison is still implemented so a
// future source with a genuine value slots in without engine changes.
function compareRegistrationUrl(officialUrl, draftUrl, critical) {
  if (draftUrl === null) {
    return fieldResult('registrationUrl', officialUrl, null, STATES.NOT_APPLICABLE, 'The draft provides no registration URL.', critical);
  }
  if (officialUrl === null) {
    return fieldResult('registrationUrl', null, draftUrl, STATES.UNVERIFIABLE, 'The official record provides no authoritative registration URL, so the draft URL cannot be verified.', critical);
  }
  if (officialUrl === draftUrl) {
    return fieldResult('registrationUrl', officialUrl, draftUrl, STATES.MATCH, 'Registration URL matches the official event record.', critical);
  }
  return fieldResult('registrationUrl', officialUrl, draftUrl, STATES.MISMATCH, 'The announcement registration URL differs from the official event record.', critical, officialUrl);
}

module.exports = {
  STATES,
  buildVenueAliasLookup,
  compareTitle,
  compareVenue,
  compareTime,
  compareDate,
  compareTimeZone,
  compareRegistrationUrl,
};
