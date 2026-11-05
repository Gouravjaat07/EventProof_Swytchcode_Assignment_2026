'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createCalendarProvider } = require('../../../src/infrastructure/swytchcode/calendar.provider');
const { NotFoundError } = require('../../../src/shared/errors/app-error');
const { googleEvent, googleListResponse } = require('../../fixtures/synthetic');

function silentLogger() {
  const warnings = [];
  const l = { debug() {}, info() {}, warn(m, f) { warnings.push({ m, f }); }, error() {}, warnings };
  l.child = () => l;
  return l;
}

function providerWith(executor, logger) {
  return createCalendarProvider({
    client: { execute: executor },
    logger: logger || silentLogger(),
    methodEvents: 'calendar.event.get',
    methodEvent: 'calendar.event.get1',
  });
}

describe('CalendarProvider', () => {
  it('lists and normalizes events, passing documented params', async () => {
    let seen;
    const provider = providerWith(async ({ tool, params }) => {
      seen = { tool, params };
      return { data: googleListResponse([googleEvent(), googleEvent({ id: 'e2' })]), meta: {} };
    });
    const out = await provider.listEvents({ calendarId: 'primary', maxResults: 10 });
    assert.equal(out.events.length, 2);
    assert.equal(out.events[0].source, 'google_calendar');
    assert.equal(out.nextPageToken, null);
    assert.equal(out.calendarTimeZone, 'Asia/Kolkata');
    assert.equal(seen.tool, 'calendar.event.get');
    assert.equal(seen.params.calendarId, 'primary');
    assert.equal(seen.params.singleEvents, 'true');
    assert.equal(seen.params.orderBy, 'startTime');
  });

  it('treats omitted items as an empty list', async () => {
    const provider = providerWith(async () => ({ data: { kind: 'calendar#events' }, meta: {} }));
    const out = await provider.listEvents({ calendarId: 'primary' });
    assert.deepEqual(out.events, []);
  });

  it('treats an explicit empty items array as a successful empty list', async () => {
    const provider = providerWith(async () => (
      { data: { kind: 'calendar#events', items: [], timeZone: 'Asia/Kolkata' }, meta: {} }
    ));
    const out = await provider.listEvents({ calendarId: 'primary' });
    assert.deepEqual(out.events, []);
    assert.equal(out.nextPageToken, null);
    assert.equal(out.calendarTimeZone, 'Asia/Kolkata');
  });

  it('rejects malformed collections', async () => {
    for (const data of [null, [], { items: 'nope' }, 'str']) {
      const provider = providerWith(async () => ({ data, meta: {} }));
      await assert.rejects(() => provider.listEvents({ calendarId: 'primary' }), (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE');
    }
  });

  it('drops single bad items loudly, fails when all are bad', async () => {
    const logger = silentLogger();
    const partial = providerWith(async () => (
      { data: googleListResponse([googleEvent(), { id: 42, start: {} }]), meta: {} }
    ), logger);
    const out = await partial.listEvents({ calendarId: 'primary' });
    assert.equal(out.events.length, 1);
    assert.equal(logger.warnings.length, 1);

    const total = providerWith(async () => ({ data: googleListResponse([{ nope: true }]), meta: {} }));
    await assert.rejects(() => total.listEvents({ calendarId: 'primary' }), (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE');
  });

  it('translates list-404 (unknown calendar) to CONFIGURATION_ERROR', async () => {
    const provider = providerWith(async () => { throw new NotFoundError('EVENT_NOT_FOUND', 'x'); });
    await assert.rejects(
      () => provider.listEvents({ calendarId: 'bogus' }),
      (e) => e.code === 'CONFIGURATION_ERROR' && e.status === 500
    );
  });

  it('fetches one event by exact id via the single-get method', async () => {
    let seen;
    const provider = providerWith(async ({ tool, params }) => {
      seen = { tool, params };
      return { data: googleEvent({ id: 'want' }), meta: {} };
    });
    const found = await provider.getEventById({ calendarId: 'primary', eventId: 'want' });
    assert.equal(seen.tool, 'calendar.event.get1');
    assert.deepEqual(seen.params, { calendarId: 'primary', eventId: 'want' });
    assert.equal(found.sourceEventId, 'want');
    assert.equal(found.source, 'google_calendar');
    assert.equal(found.sourceReference.calendarId, 'primary');
  });

  it('returns cancelled events from exact get (the caller decides)', async () => {
    const provider = providerWith(async () => (
      { data: googleEvent({ id: 'c1', status: 'cancelled' }), meta: {} }
    ));
    const found = await provider.getEventById({ calendarId: 'primary', eventId: 'c1' });
    assert.equal(found.sourceEventId, 'c1');
    assert.equal(found.status, 'cancelled');
  });

  it('maps exact-get 404 to null (unknown event, not a crash)', async () => {
    const noted = [];
    const provider = createCalendarProvider({
      client: { execute: async () => { throw new NotFoundError('EVENT_NOT_FOUND', 'x'); } },
      logger: silentLogger(),
      methodEvents: 'calendar.event.get',
      methodEvent: 'calendar.event.get1',
      fetchLog: { record: async (r) => { noted.push(r); } },
    });
    const out = await provider.getEventById({ calendarId: 'primary', eventId: 'ghost' });
    assert.equal(out, null);
    assert.deepEqual(noted, [{ outcome: 'failure', errorCategory: 'EVENT_NOT_FOUND' }]);
  });

  it('rejects malformed single-event payloads', async () => {
    for (const data of [null, [], { nope: true }, { id: 42 }, 'str']) {
      const provider = providerWith(async () => ({ data, meta: {} }));
      await assert.rejects(
        () => provider.getEventById({ calendarId: 'primary', eventId: 'x' }),
        (e) => e.code === 'SWYTCHCODE_INVALID_RESPONSE'
      );
    }
  });

  it('logs fetch telemetry without breaking reads', async () => {
    const noted = [];
    const provider = createCalendarProvider({
      client: { execute: async () => ({ data: googleListResponse([googleEvent()]), meta: {} }) },
      logger: silentLogger(),
      methodEvents: 'calendar.event.get',
      methodEvent: 'calendar.event.get1',
      fetchLog: { record: async (r) => { noted.push(r); } },
    });
    await provider.listEvents({ calendarId: 'primary' });
    assert.deepEqual(noted, [{ outcome: 'success', errorCategory: undefined }]);

    const failing = createCalendarProvider({
      client: { execute: async () => { throw new NotFoundError('EVENT_NOT_FOUND', 'x'); } },
      logger: silentLogger(),
      methodEvents: 'calendar.event.get',
      methodEvent: 'calendar.event.get1',
      fetchLog: { record: async () => { throw new Error('log gone'); } },
    });
    // Telemetry failure must not mask the real error.
    await assert.rejects(() => failing.listEvents({ calendarId: 'primary' }), (e) => e.code === 'CONFIGURATION_ERROR');
  });
});
