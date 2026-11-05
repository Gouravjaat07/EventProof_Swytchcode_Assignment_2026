'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDateOnly,
  parseTimeValue,
  isValidTimeZone,
  canonicalTimeZone,
  renderInTimeZone,
  parseRfc3339,
  addDaysUtc,
  utcWindowAround,
} = require('../../../src/domain/time/datetime');

describe('parseDateOnly', () => {
  it('accepts valid ISO dates', () => {
    assert.equal(parseDateOnly('2026-08-07'), '2026-08-07');
    assert.equal(parseDateOnly('2026-12-31'), '2026-12-31');
  });

  it('honors leap years', () => {
    assert.equal(parseDateOnly('2024-02-29'), '2024-02-29');
    assert.equal(parseDateOnly('2025-02-29'), null);
    assert.equal(parseDateOnly('2000-02-29'), '2000-02-29');
    assert.equal(parseDateOnly('1900-02-29'), null);
  });

  it('rejects impossible and malformed dates', () => {
    assert.equal(parseDateOnly('2026-02-30'), null);
    assert.equal(parseDateOnly('2026-13-01'), null);
    assert.equal(parseDateOnly('2026-00-10'), null);
    assert.equal(parseDateOnly('2026-8-7'), null);
    assert.equal(parseDateOnly('07/08/2026'), null);
    assert.equal(parseDateOnly(''), null);
    assert.equal(parseDateOnly(null), null);
    assert.equal(parseDateOnly(20260807), null);
  });
});

describe('parseTimeValue', () => {
  it('parses 24-hour times', () => {
    assert.equal(parseTimeValue('09:00'), '09:00');
    assert.equal(parseTimeValue('9:00'), '09:00');
    assert.equal(parseTimeValue('23:59'), '23:59');
    assert.equal(parseTimeValue('00:00'), '00:00');
  });

  it('parses 12-hour times incl. noon/midnight edges', () => {
    assert.equal(parseTimeValue('9:00 AM'), '09:00');
    assert.equal(parseTimeValue('9:00AM'), '09:00');
    assert.equal(parseTimeValue('12:00 AM'), '00:00');
    assert.equal(parseTimeValue('12:00 PM'), '12:00');
    assert.equal(parseTimeValue('1:05 p.m.'), '13:05');
  });

  it('rejects invalid times', () => {
    assert.equal(parseTimeValue('24:00'), null);
    assert.equal(parseTimeValue('25:00'), null);
    assert.equal(parseTimeValue('12:60'), null);
    assert.equal(parseTimeValue('noon'), null);
    assert.equal(parseTimeValue('9'), null);
    assert.equal(parseTimeValue(''), null);
    assert.equal(parseTimeValue(null), null);
  });
});

describe('time zones', () => {
  it('validates IANA names via Intl', () => {
    assert.equal(isValidTimeZone('Asia/Kolkata'), true);
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('Bogus/Zone'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone(null), false);
  });

  it('canonicalizes spellings deterministically', () => {
    // Pinned to the platform ICU: equivalent spellings resolve identically.
    assert.equal(canonicalTimeZone('utc'), canonicalTimeZone('UTC'));
    assert.equal(canonicalTimeZone('asia/kolkata'), canonicalTimeZone('Asia/Kolkata'));
    assert.equal(canonicalTimeZone('Asia/Calcutta'), canonicalTimeZone('Asia/Kolkata'));
    assert.equal(canonicalTimeZone('Bogus/Zone'), null);
  });
});

describe('renderInTimeZone', () => {
  it('renders instants in the event zone (DST-aware)', () => {
    // 2026-08-07T10:00:00+05:30 -> Asia/Kolkata wall time 10:00.
    const ms = Date.parse('2026-08-07T10:00:00+05:30');
    assert.deepEqual(renderInTimeZone(ms, 'Asia/Kolkata'), { date: '2026-08-07', time: '10:00' });
    // Same instant is 04:30 UTC — the zone decides the wall time.
    assert.deepEqual(renderInTimeZone(ms, 'UTC'), { date: '2026-08-07', time: '04:30' });
  });

  it('renders midnight as 00:xx, never 24:xx', () => {
    const out = renderInTimeZone(Date.parse('2026-01-01T00:00:00Z'), 'UTC');
    assert.deepEqual(out, { date: '2026-01-01', time: '00:00' });
  });

  it('handles DST transitions without inventing dates', () => {
    // US DST starts 2026-03-08 02:00 -> 03:00 local; 07:30Z is 03:30 EDT.
    const out = renderInTimeZone(Date.parse('2026-03-08T07:30:00Z'), 'America/New_York');
    assert.deepEqual(out, { date: '2026-03-08', time: '03:30' });
  });

  it('rejects bad input', () => {
    assert.equal(renderInTimeZone(NaN, 'UTC'), null);
    assert.equal(renderInTimeZone(Date.now(), 'Bogus/Zone'), null);
  });
});

describe('parseRfc3339 / windows', () => {
  it('parses only valid timestamps', () => {
    assert.equal(typeof parseRfc3339('2026-08-07T10:00:00+05:30'), 'number');
    assert.equal(parseRfc3339('not-a-date'), null);
    assert.equal(parseRfc3339(''), null);
  });

  it('shifts calendar dates across month/year boundaries', () => {
    assert.equal(addDaysUtc('2026-01-01', -1), '2025-12-31');
    assert.equal(addDaysUtc('2024-02-28', 1), '2024-02-29');
    assert.equal(addDaysUtc('bogus', 1), null);
  });

  it('builds UTC windows around a draft date', () => {
    assert.deepEqual(utcWindowAround('2026-08-07', 1), {
      timeMin: '2026-08-06T00:00:00Z',
      timeMax: '2026-08-09T00:00:00Z',
    });
    assert.equal(utcWindowAround('bogus', 1), null);
  });
});
