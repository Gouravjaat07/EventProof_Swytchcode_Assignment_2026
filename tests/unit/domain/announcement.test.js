'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateAnnouncementDraft } = require('../../../src/domain/announcement/announcement.model');

describe('validateAnnouncementDraft', () => {
  it('accepts a complete valid draft and normalizes it', () => {
    const out = validateAnnouncementDraft({
      title: '  Hacknite 2026 ',
      eventDate: '2026-08-07',
      startTime: '9:00 AM',
      endTime: '6:00 PM',
      timeZone: 'Asia/Kolkata',
      venue: '  SVSU  Campus ',
      registrationUrl: 'https://example.test/register?x=1',
      description: 'Hello',
      extraUnknownField: 'stripped',
    });
    assert.equal(out.title, 'Hacknite 2026');
    assert.equal(out.eventDate, '2026-08-07');
    assert.equal(out.startTime, '09:00');
    assert.equal(out.endTime, '18:00');
    assert.equal(out.overnight, false);
    assert.equal(out.timeZone, 'Asia/Kolkata');
    assert.equal(out.venue, 'SVSU Campus');
    assert.equal(out.registrationUrl, 'https://example.test/register?x=1');
    assert.equal(out.extraUnknownField, undefined);
    assert.ok(Object.isFrozen(out));
  });

  it('accepts drafts with only required fields', () => {
    const out = validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01' });
    assert.equal(out.startTime, null);
    assert.equal(out.endTime, null);
    assert.equal(out.timeZone, null);
    assert.equal(out.venue, null);
    assert.equal(out.registrationUrl, null);
    assert.equal(out.overnight, false);
  });

  it('rejects missing title and date', () => {
    assert.throws(() => validateAnnouncementDraft({ eventDate: '2026-01-01' }), (e) => e.code === 'MISSING_REQUIRED_FIELD');
    assert.throws(() => validateAnnouncementDraft({ title: 'T' }), (e) => e.code === 'MISSING_REQUIRED_FIELD');
    assert.throws(() => validateAnnouncementDraft({ title: '   ', eventDate: '2026-01-01' }), (e) => e.code === 'MISSING_REQUIRED_FIELD');
  });

  it('rejects non-object drafts and coerces nothing', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      assert.throws(() => validateAnnouncementDraft(bad), (e) => e.code === 'INVALID_REQUEST');
    }
    assert.throws(
      () => validateAnnouncementDraft({ title: 42, eventDate: '2026-01-01' }),
      (e) => e.code === 'INVALID_REQUEST'
    );
  });

  it('rejects invalid dates semantically (422)', () => {
    assert.throws(
      () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-02-30' }),
      (e) => e.code === 'INVALID_DATE' && e.status === 422
    );
  });

  it('rejects invalid times and zero-length intervals, allows overnight', () => {
    assert.throws(
      () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01', startTime: '25:00' }),
      (e) => e.code === 'INVALID_TIME'
    );
    assert.throws(
      () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01', startTime: '10:00', endTime: '10:00' }),
      (e) => e.code === 'INVALID_TIME'
    );
    const overnight = validateAnnouncementDraft({
      title: 'T', eventDate: '2026-01-01', startTime: '22:00', endTime: '02:00',
    });
    assert.equal(overnight.overnight, true);
  });

  it('rejects invalid time zones', () => {
    assert.throws(
      () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01', timeZone: 'Mars/Olympus' }),
      (e) => e.code === 'INVALID_TIMEZONE' && e.status === 422
    );
  });

  it('validates registration URLs strictly', () => {
    const good = validateAnnouncementDraft({
      title: 'T', eventDate: '2026-01-01', registrationUrl: 'HTTPS://Example.TEST:443/a?b=c',
    });
    assert.equal(good.registrationUrl, 'https://example.test/a?b=c'); // host lowercased, default port dropped
    for (const bad of ['notaurl', 'ftp://example.test/x', 'https://user:pass@example.test/', '//example.test/x', 'https:///']) {
      assert.throws(
        () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01', registrationUrl: bad }),
        (e) => e.code === 'INVALID_REGISTRATION_URL',
        bad
      );
    }
  });

  it('enforces length caps', () => {
    assert.throws(
      () => validateAnnouncementDraft({ title: 'x'.repeat(301), eventDate: '2026-01-01' }),
      (e) => e.code === 'INVALID_REQUEST'
    );
    assert.throws(
      () => validateAnnouncementDraft({ title: 'T', eventDate: '2026-01-01', venue: 'x'.repeat(501) }),
      (e) => e.code === 'INVALID_REQUEST'
    );
  });
});
