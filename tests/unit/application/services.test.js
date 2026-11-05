'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createFetchEventsService } = require('../../../src/application/services/fetch-events.service');
const { createVerifyAnnouncementService } = require('../../../src/application/services/verify-announcement.service');
const { createInMemoryAuditRepository } = require('../../../src/infrastructure/repositories/audit.repository');
const { normalizeOfficialEvent } = require('../../../src/domain/event/event.model');
const { googleEvent, draft } = require('../../fixtures/synthetic');

function silentLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {} };
  l.child = () => l;
  return l;
}

function testConfig(overrides = {}) {
  return {
    calendarId: 'primary',
    verifySearchWindowDays: 3,
    eventsMaxResults: 50,
    eventsMaxRangeDays: 366,
    venueAliases: {},
    ...overrides,
  };
}

function official(overrides = {}) {
  return normalizeOfficialEvent(googleEvent(overrides));
}

describe('FetchEventsService', () => {
  it('lists events through the provider with validated params', async () => {
    const events = [official()];
    const seen = [];
    const svc = createFetchEventsService({
      eventSource: {
        listEvents: async (q) => { seen.push(q); return { events, nextPageToken: 'tok', calendarTimeZone: 'UTC' }; },
        getEventById: async () => null,
      },
      logger: silentLogger(),
      config: testConfig(),
    });
    const out = await svc.listEvents({ timeMin: '2026-08-01T00:00:00Z', timeMax: '2026-08-31T00:00:00Z', limit: '10' });
    assert.equal(out.events.length, 1);
    assert.equal(out.nextPageToken, 'tok');
    assert.equal(seen[0].calendarId, 'primary');
    assert.equal(seen[0].maxResults, 10);
  });

  it('rejects invalid list input without calling the provider', async () => {
    let called = 0;
    const svc = createFetchEventsService({
      eventSource: {
        listEvents: async () => { called += 1; return { events: [], nextPageToken: null }; },
        getEventById: async () => null,
      },
      logger: silentLogger(),
      config: testConfig(),
    });
    await assert.rejects(() => svc.listEvents({ limit: 'abc' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(() => svc.listEvents({ limit: '0' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(
      () => svc.listEvents({ timeMin: '2026-08-02T00:00:00Z', timeMax: '2026-08-01T00:00:00Z' }),
      (e) => e.code === 'INVALID_DATE'
    );
    await assert.rejects(
      () => svc.listEvents({ timeMin: '2020-01-01T00:00:00Z', timeMax: '2026-01-01T00:00:00Z' }),
      (e) => e.code === 'INVALID_DATE'
    );
    await assert.rejects(() => svc.listEvents({ calendarId: 'has space' }), (e) => e.code === 'INVALID_REQUEST');
    assert.equal(called, 0);
  });

  it('gets one event, maps null to EVENT_NOT_FOUND', async () => {
    const svc = createFetchEventsService({
      eventSource: {
        listEvents: async () => ({ events: [], nextPageToken: null }),
        getEventById: async ({ eventId }) => (eventId === 'found' ? official({ id: 'found' }) : null),
      },
      logger: silentLogger(),
      config: testConfig(),
    });
    const e = await svc.getEventById({ eventId: 'found' });
    assert.equal(e.sourceEventId, 'found');
    await assert.rejects(() => svc.getEventById({ eventId: 'missing' }), (e) => e.code === 'EVENT_NOT_FOUND');
    await assert.rejects(() => svc.getEventById({ eventId: '' }), (e) => e.code === 'INVALID_EVENT_ID');
  });
});

describe('VerifyAnnouncementService', () => {
  function setup(event) {
    let calls = 0;
    const audit = createInMemoryAuditRepository({ maxRecords: 10 });
    const svc = createVerifyAnnouncementService({
      eventSource: {
        listEvents: async () => ({ events: [], nextPageToken: null }),
        getEventById: async () => { calls += 1; return event; },
      },
      auditRepository: audit,
      logger: silentLogger(),
      config: testConfig(),
    });
    return { svc, audit, calls: () => calls };
  }

  it('verifies a matching draft and audits the record', async () => {
    const { svc, audit } = setup(official());
    const r = await svc.verify({ eventId: 'synthetic_evt_001', announcement: draft(), requestId: 'req-1' });
    assert.equal(r.status, 'VERIFIED');
    assert.equal(r.eventReference.sourceEventId, 'synthetic_evt_001');
    assert.ok(r.verificationId);
    const stored = await audit.getById(r.verificationId);
    assert.equal(stored.status, 'VERIFIED');
    assert.equal(stored.requestId, 'req-1');
  });

  it('returns REVIEW_REQUIRED for mismatches (no throw)', async () => {
    const { svc } = setup(official());
    const r = await svc.verify({ eventId: 'synthetic_evt_001', announcement: draft({ eventDate: '2026-08-08' }) });
    assert.equal(r.status, 'REVIEW_REQUIRED');
  });

  it('rejects unknown and cancelled events (never VERIFIED)', async () => {
    const missing = setup(null);
    await assert.rejects(
      () => missing.svc.verify({ eventId: 'nope', announcement: draft() }),
      (e) => e.code === 'EVENT_NOT_FOUND'
    );
    const cancelled = setup(official({ status: 'cancelled' }));
    await assert.rejects(
      () => cancelled.svc.verify({ eventId: 'x', announcement: draft() }),
      (e) => e.code === 'EVENT_CANCELLED' && e.status === 409
    );
  });

  it('never fetches for invalid drafts (INVARIANT 8)', async () => {
    const { svc, calls } = setup(official());
    await assert.rejects(
      () => svc.verify({ eventId: 'x', announcement: draft({ eventDate: '2026-13-99' }) }),
      (e) => e.code === 'INVALID_DATE'
    );
    await assert.rejects(
      () => svc.verify({ eventId: '', announcement: draft() }),
      (e) => e.code === 'INVALID_EVENT_ID'
    );
    assert.equal(calls(), 0);
  });

  it('fails loudly when audit persistence fails (Phase 2 durability contract)', async () => {
    const svc = createVerifyAnnouncementService({
      eventSource: { getEventById: async () => official() },
      auditRepository: { save: async () => { throw new Error('disk gone'); }, getById: async () => null },
      logger: silentLogger(),
      config: testConfig(),
    });
    await assert.rejects(
      () => svc.verify({ eventId: 'x', announcement: draft() }),
      (e) => e.code === 'AUDIT_STORAGE_UNAVAILABLE' && e.status === 503
    );
  });
});
