'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOfficialEvent, isCancelled } = require('../../../src/domain/event/event.model');
const { googleEvent } = require('../../fixtures/synthetic');

describe('normalizeOfficialEvent', () => {
  it('normalizes a timed event in its own zone', () => {
    const e = normalizeOfficialEvent(googleEvent(), { source: 'google_calendar', calendarId: 'primary' });
    assert.equal(e.sourceEventId, 'synthetic_evt_001');
    assert.equal(e.title, 'Hacknite 2026');
    assert.equal(e.startDate, '2026-08-07');
    assert.equal(e.startTime, '10:00');
    assert.equal(e.endDate, '2026-08-07');
    assert.equal(e.endTime, '18:00');
    assert.equal(e.timeZone, 'Asia/Kolkata');
    assert.equal(e.timeZoneSource, 'event');
    assert.equal(e.allDay, false);
    assert.equal(e.location, 'SVSU Campus');
    assert.equal(e.status, 'confirmed');
    assert.equal(typeof e.startInstantMs, 'number');
    assert.ok(Object.isFrozen(e));
  });

  it('renders offsets, not naive strings (INVARIANT 16)', () => {
    // 10:00+05:30 rendered in the event zone stays 10:00; a naive UTC parse
    // would show 04:30.
    const e = normalizeOfficialEvent(
      googleEvent({ start: { dateTime: '2026-08-07T10:00:00+05:30', timeZone: 'Asia/Kolkata' } })
    );
    assert.equal(e.startTime, '10:00');
  });

  it('uses floating wall times verbatim (no UTC-shift bug)', () => {
    const e = normalizeOfficialEvent(
      googleEvent({
        start: { dateTime: '2026-08-07T10:00:00' },
        end: { dateTime: '2026-08-07T18:00:00' },
      }),
      { calendarTimeZone: 'Asia/Kolkata' }
    );
    assert.equal(e.startTime, '10:00');
    assert.equal(e.endTime, '18:00');
    assert.equal(e.startInstantMs, null);
    assert.equal(e.timeZone, 'Asia/Kolkata');
    assert.equal(e.timeZoneSource, 'calendar');
  });

  it('falls back to UTC visibly when no zone is known', () => {
    const e = normalizeOfficialEvent(
      googleEvent({
        start: { dateTime: '2026-08-07T10:00:00Z' },
        end: { dateTime: '2026-08-07T11:00:00Z' },
      })
    );
    assert.equal(e.timeZone, 'UTC');
    assert.equal(e.timeZoneSource, 'utc-fallback');
  });

  it('normalizes all-day events (no times, exclusive end kept)', () => {
    const e = normalizeOfficialEvent(
      googleEvent({ start: { date: '2026-08-07' }, end: { date: '2026-08-08' } })
    );
    assert.equal(e.allDay, true);
    assert.equal(e.startDate, '2026-08-07');
    assert.equal(e.endDate, '2026-08-08');
    assert.equal(e.startTime, null);
    assert.equal(e.timeZone, null);
  });

  it('preserves cancellation and missing optionals as data', () => {
    const cancelled = normalizeOfficialEvent(googleEvent({ status: 'cancelled' }));
    assert.equal(isCancelled(cancelled), true);
    const bare = normalizeOfficialEvent({ id: 'x', start: { date: '2026-01-01' } });
    assert.equal(bare.title, null);
    assert.equal(bare.location, null);
    assert.equal(bare.status, null);
    assert.equal(isCancelled(bare), false);
  });

  it('truncates descriptions and keeps source references', () => {
    const e = normalizeOfficialEvent(googleEvent({ description: 'd'.repeat(5000) }), { calendarId: 'primary' });
    assert.equal(e.description.length, 2000);
    assert.equal(e.sourceReference.calendarId, 'primary');
    assert.ok(e.sourceReference.htmlLink.includes('google.com'));
  });

  it('rejects structural corruption as SWYTCHCODE_INVALID_RESPONSE', () => {
    for (const bad of [null, 42, [], {}, { start: { date: '2026-01-01' } }, { id: 'x' }]) {
      assert.throws(() => normalizeOfficialEvent(bad), (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE');
    }
    assert.throws(
      () => normalizeOfficialEvent(googleEvent({ start: { dateTime: 'not-a-time' } })),
      (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE'
    );
    assert.throws(
      () => normalizeOfficialEvent(googleEvent({ summary: 42 })),
      (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE'
    );
  });
});
