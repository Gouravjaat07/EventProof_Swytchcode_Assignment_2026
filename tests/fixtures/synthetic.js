'use strict';

// SYNTHETIC fixtures. Every object below is hand-written for tests and must
// NEVER be presented as an actual Swytchcode/Google API response. Real
// captured CLI envelopes live inline in the tests that assert them.

function googleEvent(overrides = {}) {
  return {
    kind: 'calendar#event',
    id: 'synthetic_evt_001',
    status: 'confirmed',
    summary: 'Hacknite 2026',
    description: 'A synthetic campus hackathon used only for tests.',
    location: 'SVSU Campus',
    creator: { email: 'organizer@example.test' },
    organizer: { email: 'organizer@example.test', displayName: 'Organizer' },
    start: { dateTime: '2026-08-07T10:00:00+05:30', timeZone: 'Asia/Kolkata' },
    end: { dateTime: '2026-08-07T18:00:00+05:30', timeZone: 'Asia/Kolkata' },
    updated: '2026-07-01T00:00:00.000Z',
    htmlLink: 'https://www.google.com/calendar/event?eid=c3ludGhldGlj',
    ...overrides,
  };
}

function googleListResponse(items, overrides = {}) {
  return {
    kind: 'calendar#events',
    etag: '"synthetic-etag"',
    summary: 'organizer@example.test',
    timeZone: 'Asia/Kolkata',
    items,
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    title: 'Hacknite 2026',
    eventDate: '2026-08-07',
    startTime: '10:00',
    endTime: '18:00',
    timeZone: 'Asia/Kolkata',
    venue: 'SVSU Campus',
    ...overrides,
  };
}

module.exports = { googleEvent, googleListResponse, draft };
