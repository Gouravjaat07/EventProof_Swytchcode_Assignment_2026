'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const inject = require('light-my-request');
const { createApp } = require('../../src/interfaces/http/app');
const { createFetchEventsService } = require('../../src/application/services/fetch-events.service');
const { createVerifyAnnouncementService } = require('../../src/application/services/verify-announcement.service');
const { createHistoryService } = require('../../src/application/services/history.service');
const { createIntegrationService } = require('../../src/application/services/integration.service');
const { createInMemoryAuditRepository } = require('../../src/infrastructure/repositories/audit.repository');
const { normalizeOfficialEvent } = require('../../src/domain/event/event.model');
const { googleEvent, draft } = require('../fixtures/synthetic');

function silentLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {} };
  l.child = () => l;
  return l;
}

function testConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    calendarId: 'primary',
    swytchcodeMethodEvents: 'calendar.event.get',
    verifySearchWindowDays: 3,
    eventsMaxResults: 50,
    eventsMaxRangeDays: 366,
    venueAliases: {},
    corsOrigins: [],
    rateLimitMax: 1000,
    rateLimitWindowMs: 60000,
    ...overrides,
  };
}

// Fake provider holding SYNTHETIC events (never presented as live data).
function fakeProvider(events) {
  return {
    listEvents: async ({ maxResults }) => ({ events: events.slice(0, maxResults), nextPageToken: null }),
    getEventById: async ({ eventId }) => events.find((e) => e.sourceEventId === eventId) || null,
  };
}

function buildApp(events, configOverrides, probeOverrides) {
  const config = testConfig(configOverrides);
  const logger = silentLogger();
  const eventSource = fakeProvider(events);
  const auditRepository = createInMemoryAuditRepository({ maxRecords: 100 });
  const fetchEventsService = createFetchEventsService({ eventSource, logger, config });
  const verifyService = createVerifyAnnouncementService({ eventSource, auditRepository, logger, config });
  const historyService = createHistoryService({ auditRepository, logger });
  const integrationService = createIntegrationService({
    probe: {
      cliVersion: () => ({ available: true, version: '9.9.9-test' }),
      authStatus: () => ({ state: 'unknown', checkedAt: '2026-01-01T00:00:00.000Z' }),
      ...probeOverrides,
    },
    fetchLog: null,
    logger,
    config,
  });
  const app = createApp({ config, fetchEventsService, verifyService, auditRepository, historyService, integrationService, logger });
  app.auditRepository = auditRepository; // test seam for seeding history
  return app;
}

const oneEvent = () => [normalizeOfficialEvent(googleEvent())];

function json(res) {
  return JSON.parse(res.body);
}

describe('API', () => {
  it('GET /health is a local liveness probe with safe headers', async () => {
    const res = await inject(buildApp([]), { method: 'GET', url: '/api/v1/health' });
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(typeof body.data.version, 'string');
    assert.equal(body.data.swytchcode.configured, true);
    assert.ok(res.headers['x-request-id']);
    assert.equal(body.meta.requestId, res.headers['x-request-id']);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('GET /events lists; validates range/limit', async () => {
    const app = buildApp(oneEvent());
    const okRes = await inject(app, { method: 'GET', url: '/api/v1/events?limit=10' });
    assert.equal(okRes.statusCode, 200);
    assert.equal(json(okRes).data.events.length, 1);

    const badLimit = await inject(app, { method: 'GET', url: '/api/v1/events?limit=abc' });
    assert.equal(badLimit.statusCode, 400);
    assert.equal(json(badLimit).error.code, 'INVALID_REQUEST');

    const badRange = await inject(app, {
      method: 'GET', url: '/api/v1/events?timeMin=2026-08-02T00:00:00Z&timeMax=2026-08-01T00:00:00Z',
    });
    assert.equal(badRange.statusCode, 422);
    assert.equal(json(badRange).error.code, 'INVALID_DATE');
  });

  it('GET /events/:id returns, 404s, and still shows cancelled events', async () => {
    const cancelled = normalizeOfficialEvent(googleEvent({ id: 'c1', status: 'cancelled' }));
    const app = buildApp([...oneEvent(), cancelled]);
    const okRes = await inject(app, { method: 'GET', url: '/api/v1/events/synthetic_evt_001' });
    assert.equal(okRes.statusCode, 200);
    assert.equal(json(okRes).data.event.sourceEventId, 'synthetic_evt_001');

    const missing = await inject(app, { method: 'GET', url: '/api/v1/events/ghost' });
    assert.equal(missing.statusCode, 404);
    assert.equal(json(missing).error.code, 'EVENT_NOT_FOUND');

    const canc = await inject(app, { method: 'GET', url: '/api/v1/events/c1' });
    assert.equal(canc.statusCode, 200);
    assert.equal(json(canc).data.event.status, 'cancelled');
  });

  it('POST /verifications verifies, with 201 + Location', async () => {
    const app = buildApp(oneEvent());
    const res = await inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ eventId: 'synthetic_evt_001', announcement: draft() }),
    });
    assert.equal(res.statusCode, 201);
    const body = json(res);
    assert.equal(body.data.status, 'VERIFIED');
    assert.ok(res.headers.location.includes(`/api/v1/verifications/${body.data.verificationId}`));

    const mismatch = await inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ eventId: 'synthetic_evt_001', announcement: draft({ venue: 'Elsewhere' }) }),
    });
    assert.equal(mismatch.statusCode, 201);
    assert.equal(json(mismatch).data.status, 'REVIEW_REQUIRED');
  });

  it('POST /verifications maps domain failures to status codes', async () => {
    const cancelled = normalizeOfficialEvent(googleEvent({ id: 'c1', status: 'cancelled' }));
    const app = buildApp([...oneEvent(), cancelled]);
    const post = (payload) => inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload),
    });

    assert.equal((await post({ eventId: 'ghost', announcement: draft() })).statusCode, 404);
    const canc = await post({ eventId: 'c1', announcement: draft() });
    assert.equal(canc.statusCode, 409);
    assert.equal(json(canc).error.code, 'EVENT_CANCELLED');
    const badDraft = await post({ eventId: 'synthetic_evt_001', announcement: draft({ eventDate: 'xx' }) });
    assert.equal(badDraft.statusCode, 422);
    const noId = await post({ announcement: draft() });
    assert.equal(noId.statusCode, 400);
  });

  it('GET /verifications/:id replays audit history verbatim', async () => {
    const app = buildApp(oneEvent());
    const created = await inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ eventId: 'synthetic_evt_001', announcement: draft() }),
    });
    const id = json(created).data.verificationId;
    const replay = await inject(app, { method: 'GET', url: `/api/v1/verifications/${id}` });
    assert.equal(replay.statusCode, 200);
    assert.equal(json(replay).data.verificationId, id);

    const missing = await inject(app, { method: 'GET', url: '/api/v1/verifications/00000000-0000-0000-0000-000000000000' });
    assert.equal(missing.statusCode, 404);
    assert.equal(json(missing).error.code, 'VERIFICATION_NOT_FOUND');
  });

  it('rejects malformed/oversized/wrong-typed bodies; never leaks stacks', async () => {
    const app = buildApp(oneEvent());
    const malformed = await inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' }, payload: '{oops',
    });
    assert.equal(malformed.statusCode, 400);

    const huge = await inject(app, {
      method: 'POST', url: '/api/v1/verifications',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ blob: 'x'.repeat(300 * 1024) }),
    });
    assert.equal(huge.statusCode, 413);

    for (const res of [malformed, huge]) {
      assert.ok(!res.body.includes('at '), 'no stack frames in error bodies');
      assert.ok(!res.body.includes('stack'), 'no stack keys in error bodies');
      assert.ok(json(res).error.requestId, 'errors carry request ids');
    }
  });

  it('unknown routes 404 with the standard envelope', async () => {
    const res = await inject(buildApp([]), { method: 'DELETE', url: '/api/v1/nope' });
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error.code, 'NOT_FOUND');
  });

  it('CORS allowlist echoes only configured origins', async () => {
    const app = buildApp([], { corsOrigins: ['https://app.example.test'] });
    const allowed = await inject(app, { method: 'GET', url: '/api/v1/health', headers: { origin: 'https://app.example.test' } });
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://app.example.test');
    const denied = await inject(app, { method: 'GET', url: '/api/v1/health', headers: { origin: 'https://evil.example.test' } });
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
    const preflight = await inject(app, { method: 'OPTIONS', url: '/api/v1/health', headers: { origin: 'https://app.example.test' } });
    assert.equal(preflight.statusCode, 204);
  });

  it('rate limiter caps burst traffic with 429 + Retry-After', async () => {
    const app = buildApp([], { rateLimitMax: 2, rateLimitWindowMs: 60000 });
    assert.equal((await inject(app, { method: 'GET', url: '/api/v1/health' })).statusCode, 200);
    assert.equal((await inject(app, { method: 'GET', url: '/api/v1/health' })).statusCode, 200);
    const limited = await inject(app, { method: 'GET', url: '/api/v1/health' });
    assert.equal(limited.statusCode, 429);
    assert.equal(json(limited).error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(limited.headers['retry-after']);
  });
});

describe('History, stats, and integration status', () => {
  async function seed(app, n = 2) {
    for (let i = 0; i < n; i += 1) {
      const announcement = i === 0 ? draft() : draft({ venue: 'Elsewhere' });
      const res = await inject(app, {
        method: 'POST', url: '/api/v1/verifications',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ eventId: 'synthetic_evt_001', announcement }),
      });
      assert.equal(res.statusCode, 201);
    }
  }

  it('lists history with pagination, filters, and search', async () => {
    const app = buildApp(oneEvent());
    await seed(app, 3);
    const all = await inject(app, { method: 'GET', url: '/api/v1/verifications?page=1&pageSize=2' });
    assert.equal(all.statusCode, 200);
    assert.equal(json(all).data.records.length, 2);
    assert.equal(json(all).data.total, 3);
    assert.equal(json(all).data.totalPages, 2);

    const filtered = await inject(app, { method: 'GET', url: '/api/v1/verifications?status=REVIEW_REQUIRED' });
    assert.equal(json(filtered).data.total, 2);

    const searched = await inject(app, { method: 'GET', url: '/api/v1/verifications?q=hacknite' });
    assert.equal(json(searched).data.total, 3);

    const badStatus = await inject(app, { method: 'GET', url: '/api/v1/verifications?status=BOGUS' });
    assert.equal(badStatus.statusCode, 400);

    const beyond = await inject(app, { method: 'GET', url: '/api/v1/verifications?page=99' });
    assert.equal(beyond.statusCode, 200);
    assert.deepEqual(json(beyond).data.records, []);
  });

  it('returns genuine aggregate stats', async () => {
    const app = buildApp(oneEvent());
    const empty = await inject(app, { method: 'GET', url: '/api/v1/verifications/stats' });
    assert.deepEqual(json(empty).data, { total: 0, verified: 0, reviewRequired: 0, unverifiable: 0 });
    await seed(app, 2);
    const full = await inject(app, { method: 'GET', url: '/api/v1/verifications/stats' });
    assert.deepEqual(json(full).data, { total: 2, verified: 1, reviewRequired: 1, unverifiable: 0 });
  });

  it('reports integration status without secrets', async () => {
    const app = buildApp([]);
    const res = await inject(app, { method: 'GET', url: '/api/v1/integrations/status' });
    assert.equal(res.statusCode, 200);
    const body = json(res).data;
    assert.equal(body.backend, 'online');
    assert.equal(body.swytchcode.cliAvailable, true);
    assert.equal(body.swytchcode.method, 'calendar.event.get');
    assert.equal(body.provider.auth, 'unknown');
    assert.equal(/token|secret|password|authorization/i.test(JSON.stringify(body)), false);
    assert.equal(body.provider.lastSuccessAt, null);
  });
});
