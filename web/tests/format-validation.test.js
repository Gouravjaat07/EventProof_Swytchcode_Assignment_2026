import { describe, expect, it } from 'vitest';
import {
  displayValue, fieldLabel, fieldStateLabel, formatDateOnly, formatTime, statusLabel, timeAgo,
} from '../src/lib/format.js';
import { validateDraftLocal } from '../src/features/verification/VerifyPage.jsx';

describe('format helpers', () => {
  it('labels statuses, fields, and states', () => {
    expect(statusLabel('REVIEW_REQUIRED')).toBe('Review required');
    expect(fieldStateLabel('MISSING_IN_DRAFT')).toBe('Missing in draft');
    expect(fieldLabel('registrationUrl')).toBe('Registration URL');
    expect(fieldLabel('mystery')).toBe('mystery');
  });

  it('renders dates, times, and fallbacks', () => {
    expect(formatDateOnly('2026-08-07')).toMatch(/2026/);
    expect(formatDateOnly(null)).toBe('—');
    expect(formatTime('13:05')).toBe('1:05 PM');
    expect(formatTime('00:00')).toBe('12:00 AM');
    expect(displayValue('eventDate', null)).toBe('—');
    expect(displayValue('venue', 'Hall A')).toBe('Hall A');
  });

  it('computes relative time deterministically', () => {
    const now = Date.parse('2026-11-05T12:00:00Z');
    expect(timeAgo('2026-11-05T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-11-05T11:00:00Z', now)).toBe('1h ago');
    expect(timeAgo(null, now)).toBe('—');
  });
});

describe('validateDraftLocal (early feedback mirror)', () => {
  const valid = {
    title: 'T', eventDate: '2026-08-07', startTime: '10:00', endTime: '18:00',
    timeZone: 'Asia/Kolkata', venue: 'Hall', registrationUrl: 'https://example.test/r', description: '',
  };

  it('accepts valid drafts', () => {
    expect(validateDraftLocal(valid)).toEqual({});
    expect(validateDraftLocal({ ...valid, startTime: '9:00 AM', endTime: '6:00 PM' })).toEqual({});
  });

  it('flags required, date, time, zone, and URL problems', () => {
    expect(validateDraftLocal({ ...valid, title: '  ' }).title).toBeTruthy();
    expect(validateDraftLocal({ ...valid, eventDate: '2026-02-30' }).eventDate).toBeTruthy();
    expect(validateDraftLocal({ ...valid, startTime: '25:00' }).startTime).toBeTruthy();
    expect(validateDraftLocal({ ...valid, startTime: '10:00', endTime: '10:00' }).endTime).toMatch(/differ/);
    expect(validateDraftLocal({ ...valid, startTime: '22:00', endTime: '02:00' })).toEqual({});
    expect(validateDraftLocal({ ...valid, timeZone: 'Mars/X' }).timeZone).toBeTruthy();
    expect(validateDraftLocal({ ...valid, registrationUrl: 'ftp://x/y' }).registrationUrl).toBeTruthy();
    expect(validateDraftLocal({ ...valid, registrationUrl: 'https://u:p@x/' }).registrationUrl).toMatch(/credentials/);
    expect(validateDraftLocal({ ...valid, title: 'x'.repeat(301) }).title).toBeTruthy();
  });
});
