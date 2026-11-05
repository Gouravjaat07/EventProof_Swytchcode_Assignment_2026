'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { verify, STATUSES } = require('../../../src/domain/verification/engine');
const { buildVerificationResult } = require('../../../src/domain/verification/result');
const { normalizeOfficialEvent } = require('../../../src/domain/event/event.model');
const { validateAnnouncementDraft } = require('../../../src/domain/announcement/announcement.model');
const { googleEvent, draft } = require('../../fixtures/synthetic');

function official(overrides = {}) {
  return normalizeOfficialEvent(googleEvent(overrides));
}

function stateOf(result, field) {
  return result.fieldResults.find((f) => f.field === field);
}

describe('verification engine', () => {
  it('VERIFIES a fully matching draft', () => {
    const r = verify(official(), validateAnnouncementDraft(draft()));
    assert.equal(r.status, STATUSES.VERIFIED);
    assert.deepEqual(r.summary, { totalFields: 7, matchingFields: 6, mismatchingFields: 0, unverifiableFields: 1 });
    // registrationUrl is NOT_APPLICABLE (draft omits it) — never "verified".
    assert.equal(stateOf(r, 'registrationUrl').state, 'NOT_APPLICABLE');
  });

  it('tolerates case/whitespace and venue aliases', () => {
    const r = verify(
      official({ summary: '  HACKNITE 2026 ', location: 'Swami Vivekanand Subharti University' }),
      validateAnnouncementDraft(draft({ title: 'hacknite 2026', venue: 'SVSU Campus' })),
      { venueAliases: { 'svsu campus': 'Swami Vivekanand Subharti University' } }
    );
    assert.equal(r.status, STATUSES.VERIFIED);
    assert.match(stateOf(r, 'venue').explanation, /alias/);
  });

  it('REVIEW_REQUIRED on any critical mismatch (INVARIANT 7)', () => {
    const cases = [
      [{}, { title: 'Hacknight 2026' }, 'title'],
      [{}, { eventDate: '2026-08-08' }, 'eventDate'],
      [{}, { startTime: '11:00' }, 'startTime'],
      [{}, { venue: 'Somewhere Else' }, 'venue'],
    ];
    for (const [o, d, field] of cases) {
      const r = verify(official(o), validateAnnouncementDraft(draft(d)));
      assert.equal(r.status, STATUSES.REVIEW_REQUIRED, field);
      assert.equal(stateOf(r, field).state, 'MISMATCH');
      assert.ok(stateOf(r, field).correction, `${field} carries a correction`);
    }
  });

  it('REVIEW_REQUIRED on missing critical draft fields', () => {
    const r = verify(official(), validateAnnouncementDraft(draft({ startTime: undefined, venue: undefined })));
    assert.equal(r.status, STATUSES.REVIEW_REQUIRED);
    assert.equal(stateOf(r, 'startTime').state, 'MISSING_IN_DRAFT');
    assert.equal(stateOf(r, 'venue').state, 'MISSING_IN_DRAFT');
  });

  it('REVIEW_REQUIRED on non-critical mismatch', () => {
    const r = verify(official(), validateAnnouncementDraft(draft({ endTime: '19:00' })));
    assert.equal(r.status, STATUSES.REVIEW_REQUIRED);
    assert.equal(stateOf(r, 'endTime').state, 'MISMATCH');
  });

  it('UNVERIFIABLE when required source data is missing (never guessed)', () => {
    const r = verify(official({ summary: null, location: null }), validateAnnouncementDraft(draft()));
    assert.equal(r.status, STATUSES.UNVERIFIABLE);
    assert.equal(stateOf(r, 'title').state, 'MISSING_IN_SOURCE');
  });

  it('UNVERIFIABLE for draft times against all-day events', () => {
    const allDay = official({ start: { date: '2026-08-07' }, end: { date: '2026-08-08' } });
    const r = verify(allDay, validateAnnouncementDraft(draft()));
    assert.equal(r.status, STATUSES.UNVERIFIABLE);
    assert.equal(stateOf(r, 'startTime').state, 'UNVERIFIABLE');
    assert.equal(stateOf(r, 'timeZone').state, 'NOT_APPLICABLE');
  });

  it('VERIFIES all-day events when the draft claims no time', () => {
    const allDay = official({
      start: { date: '2026-08-07' }, end: { date: '2026-08-08' },
      summary: 'Hacknite 2026', location: 'SVSU Campus',
    });
    const d = validateAnnouncementDraft(draft({ startTime: undefined, endTime: undefined, timeZone: undefined }));
    const r = verify(allDay, d);
    assert.equal(r.status, STATUSES.VERIFIED);
  });

  it('never VERIFIES cancelled events (throws)', () => {
    assert.throws(
      () => verify(official({ status: 'cancelled' }), validateAnnouncementDraft(draft())),
      (e) => e.code === 'EVENT_CANCELLED'
    );
  });

  it('never VERIFIES missing/invalid inputs (throws)', () => {
    assert.throws(() => verify(null, validateAnnouncementDraft(draft())), (e) => e.code === 'VERIFICATION_FAILED');
    assert.throws(() => verify(official(), null), (e) => e.code === 'VERIFICATION_FAILED');
  });

  it('UNVERIFIABLE when the official zone fell back to UTC', () => {
    const floating = official({
      start: { dateTime: '2026-08-07T10:00:00' },
      end: { dateTime: '2026-08-07T18:00:00' },
    });
    assert.equal(floating.timeZoneSource, 'utc-fallback');
    const r = verify(floating, validateAnnouncementDraft(draft({ timeZone: undefined })));
    assert.equal(r.status, STATUSES.UNVERIFIABLE);
    assert.equal(stateOf(r, 'eventDate').state, 'UNVERIFIABLE');
    assert.equal(stateOf(r, 'startTime').state, 'UNVERIFIABLE');
  });

  it('compares in the draft frame when the instant is known but the zone is not', () => {
    const noZone = official({
      start: { dateTime: '2026-08-07T04:30:00Z' }, // == 10:00 Asia/Kolkata
      end: { dateTime: '2026-08-07T12:30:00Z' },
    });
    assert.equal(noZone.timeZoneSource, 'utc-fallback');
    const match = verify(noZone, validateAnnouncementDraft(draft({ timeZone: 'Asia/Kolkata' })));
    const start = stateOf(match, 'startTime');
    assert.equal(start.state, 'MATCH');
    assert.equal(start.official, '10:00');
    assert.match(start.explanation, /draft's time zone/);
    // Date/tz stay unverifiable (their authoritative values are unknown).
    assert.equal(match.status, STATUSES.UNVERIFIABLE);
  });

  it('precedence: critical mismatch beats critical unverifiable beats non-critical mismatch', () => {
    const both = verify(
      official({ summary: null }),
      validateAnnouncementDraft(draft({ eventDate: '2026-08-08', endTime: '19:00' }))
    );
    assert.equal(both.status, STATUSES.REVIEW_REQUIRED); // critical mismatch dominates
    const unv = verify(official({ summary: null }), validateAnnouncementDraft(draft({ endTime: '19:00' })));
    assert.equal(unv.status, STATUSES.UNVERIFIABLE); // critical gap dominates non-critical mismatch
  });

  it('registration URLs are never reported verified (INVARIANT 5)', () => {
    const r = verify(
      official(), validateAnnouncementDraft(draft({ registrationUrl: 'https://example.test/r' }))
    );
    const f = stateOf(r, 'registrationUrl');
    assert.equal(f.state, 'UNVERIFIABLE');
    assert.equal(f.correction, null);
    // The overall status may still be VERIFIED (other fields genuinely
    // matched) — but the URL field itself is never marked MATCH.
    assert.notEqual(f.state, 'MATCH');
  });

  it('keeps source and draft values distinguishable with evidence (INVARIANTS 14/15)', () => {
    const r = verify(official(), validateAnnouncementDraft(draft({ eventDate: '2026-08-08' })));
    const f = stateOf(r, 'eventDate');
    assert.equal(f.official, '2026-08-07');
    assert.equal(f.draft, '2026-08-08');
    assert.equal(f.correction, '2026-08-07');
    assert.ok(f.explanation.length > 10);
    assert.equal(typeof f.critical, 'boolean');
  });

  it('matches zones across spelling/case variants, mismatches real differences', () => {
    const same = verify(official(), validateAnnouncementDraft(draft({ timeZone: 'asia/kolkata' })));
    assert.equal(stateOf(same, 'timeZone').state, 'MATCH');
    const diff = verify(official(), validateAnnouncementDraft(draft({ timeZone: 'America/New_York' })));
    assert.equal(stateOf(diff, 'timeZone').state, 'MISMATCH');
  });
});

describe('buildVerificationResult', () => {
  function valid() {
    return {
      verificationId: '123e4567-e89b-12d3-a456-426614174000',
      status: STATUSES.VERIFIED,
      eventReference: { source: 'google_calendar', sourceEventId: 'abc', fetchedAt: '2026-01-01T00:00:00.000Z', sourceUpdatedAt: null },
      fieldResults: [{ field: 'title', state: 'MATCH' }],
      summary: { totalFields: 1, matchingFields: 1, mismatchingFields: 0, unverifiableFields: 0 },
      verifiedAt: '2026-01-01T00:00:01.000Z',
    };
  }

  it('builds a frozen result', () => {
    const r = buildVerificationResult(valid());
    assert.equal(r.status, 'VERIFIED');
    assert.ok(Object.isFrozen(r));
  });

  it('rejects malformed inputs', () => {
    assert.throws(() => buildVerificationResult({ ...valid(), verificationId: 'nope' }), (e) => e.code === 'VERIFICATION_FAILED');
    assert.throws(() => buildVerificationResult({ ...valid(), status: 'BOGUS' }), (e) => e.code === 'VERIFICATION_FAILED');
    assert.throws(() => buildVerificationResult({ ...valid(), fieldResults: [] }), (e) => e.code === 'VERIFICATION_FAILED');
    assert.throws(() => buildVerificationResult(null), (e) => e.code === 'VERIFICATION_FAILED');
  });
});
