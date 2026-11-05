// DEMO FIXTURES — synthetic data for exploring the UI without a live backend.
// Every consumer must render the DEMO banner alongside these. Demo records are
// NEVER sent to the backend and NEVER mixed into real history/statistics.

export const DEMO_EVENT = Object.freeze({
  id: 'demo_evt_001',
  source: 'google_calendar',
  sourceEventId: 'demo_evt_001',
  title: 'Hacknite 2026 (demo)',
  description: 'Synthetic demo event. Not a real calendar record.',
  startDate: '2026-08-07',
  endDate: '2026-08-07',
  startTime: '10:00',
  endTime: '18:00',
  timeZone: 'Asia/Kolkata',
  timeZoneSource: 'event',
  allDay: false,
  location: 'SVSU Campus (demo)',
  status: 'confirmed',
  sourceUpdatedAt: '2026-07-01T00:00:00.000Z',
  fetchedAt: '2026-11-05T00:00:00.000Z',
  sourceReference: { calendarId: 'primary', htmlLink: null },
});

export const DEMO_DRAFT = Object.freeze({
  title: 'Hacknite 2026 (demo)',
  eventDate: '2026-08-08',
  startTime: '10:00',
  endTime: '18:00',
  timeZone: 'Asia/Kolkata',
  venue: 'Main Auditorium (demo)',
  registrationUrl: 'https://example.test/register',
  description: '',
});

export const DEMO_RESULT = Object.freeze({
  verificationId: '00000000-0000-0000-0000-000000000000',
  status: 'REVIEW_REQUIRED',
  eventReference: {
    source: 'google_calendar',
    sourceEventId: 'demo_evt_001',
    fetchedAt: '2026-11-05T00:00:00.000Z',
    sourceUpdatedAt: '2026-07-01T00:00:00.000Z',
  },
  summary: { totalFields: 7, matchingFields: 4, mismatchingFields: 2, unverifiableFields: 1 },
  fieldResults: [
    { field: 'title', official: 'Hacknite 2026 (demo)', draft: 'Hacknite 2026 (demo)', state: 'MATCH', explanation: 'Title matches the official event record.', correction: null, critical: true },
    { field: 'eventDate', official: '2026-08-07', draft: '2026-08-08', state: 'MISMATCH', explanation: 'The announcement event date differs from the official event record.', correction: '2026-08-07', critical: true },
    { field: 'startTime', official: '10:00', draft: '10:00', state: 'MATCH', explanation: 'Start time matches the official event record.', correction: null, critical: true },
    { field: 'endTime', official: '18:00', draft: '18:00', state: 'MATCH', explanation: 'End time matches the official event record.', correction: null, critical: false },
    { field: 'timeZone', official: 'Asia/Kolkata', draft: 'Asia/Kolkata', state: 'MATCH', explanation: 'Time zone matches the official event record.', correction: null, critical: false },
    { field: 'venue', official: 'SVSU Campus (demo)', draft: 'Main Auditorium (demo)', state: 'MISMATCH', explanation: 'The announcement venue differs from the official event record.', correction: 'SVSU Campus (demo)', critical: true },
    { field: 'registrationUrl', official: null, draft: 'https://example.test/register', state: 'UNVERIFIABLE', explanation: 'The official record provides no authoritative registration URL, so the draft URL cannot be verified.', correction: null, critical: false },
  ],
  verifiedAt: '2026-11-05T00:00:00.000Z',
  demo: true,
});

export const DEMO_STATS = Object.freeze({ total: 12, verified: 7, reviewRequired: 4, unverifiable: 1, demo: true });
