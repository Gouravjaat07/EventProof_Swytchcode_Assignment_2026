'use strict';

// Deterministic date/time utilities. No external dependencies; IANA time-zone
// handling delegates to the platform ICU database (Node 22 ships full ICU).
//
// Accepted draft formats (anything else is INVALID, never coerced):
//  - date: exactly "YYYY-MM-DD" naming a real calendar date (leap years honored)
//  - time: "HH:MM" (24-hour, 00:00–23:59) or "h:MM AM/PM" (12-hour, case- and
//    spacing-tolerant: "9:00 AM", "9:00AM", "9:00 a.m." all parse to "09:00")
//  - timeZone: any IANA name accepted by Intl (validated, then canonicalized
//    via resolvedOptions().timeZone when the platform provides it)

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_24_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TIME_12_RE = /^(0?\d|1[0-2]):([0-5]\d)\s*([APap])\.?\s*[Mm]\.?$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Strict calendar-date validation with round-trip check (rejects 2026-02-30,
// 2025-02-29, month 13, …). Returns the normalized "YYYY-MM-DD" or null.
function parseDateOnly(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Parses 24-hour and 12-hour times to "HH:MM", or null when invalid.
// "24:00" is rejected (midnight is "00:00"); hours/minutes out of range reject.
function parseTimeValue(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  let m = TIME_24_RE.exec(s);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  m = TIME_12_RE.exec(s);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2];
  const isPM = m[3].toUpperCase() === 'P';
  if (hour === 12) hour = isPM ? 12 : 0;
  else if (isPM) hour += 12;
  return `${pad2(hour)}:${minute}`;
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Canonical IANA spelling as resolved by ICU (e.g. casing/aliases unified
// when the platform knows them). Returns null for invalid zones.
function canonicalTimeZone(tz) {
  if (typeof tz !== 'string') return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

// Renders an instant (ms) as calendar date + wall time in the given IANA zone.
// Uses hourCycle h23 so midnight renders "00:MM", never "24:MM".
function renderInTimeZone(instantMs, timeZone) {
  if (!Number.isFinite(instantMs)) return null;
  let zone = timeZone;
  if (!isValidTimeZone(zone)) return null;
  const date = new Date(instantMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : null;
  };
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  let hh = get('hour');
  const min = get('minute');
  if (!yyyy || !mm || !dd || hh === null || min === null) return null;
  if (hh === '24') hh = '00'; // defensive: some ICU builds still emit 24 at midnight
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function parseRfc3339(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// UTC day-bound arithmetic for provider search windows. addDaysUtc returns a
// "YYYY-MM-DD" shifted by n days, or null for invalid input.
function addDaysUtc(dateOnly, n) {
  const parsed = parseDateOnly(dateOnly);
  if (!parsed || !Number.isInteger(n)) return null;
  const [y, m, d] = parsed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// Builds an inclusive UTC window covering [date-days, date+days]. Bounds are
// deliberately UTC day edges (wider than any local day) so time-zone skew can
// never push the event outside the provider query.
function utcWindowAround(dateOnly, days) {
  const start = addDaysUtc(dateOnly, -days);
  const endExclusive = addDaysUtc(dateOnly, days + 1);
  if (!start || !endExclusive) return null;
  return { timeMin: `${start}T00:00:00Z`, timeMax: `${endExclusive}T00:00:00Z` };
}

module.exports = {
  parseDateOnly,
  parseTimeValue,
  isValidTimeZone,
  canonicalTimeZone,
  renderInTimeZone,
  parseRfc3339,
  addDaysUtc,
  utcWindowAround,
};
