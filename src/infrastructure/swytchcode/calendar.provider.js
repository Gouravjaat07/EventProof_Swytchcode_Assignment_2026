'use strict';

// CalendarProvider: EventSourceProvider backed by Google Calendar through
// Swytchcode. Listing uses read-only `calendar.event.get` (LIST semantics:
// calendarId + timeMin/timeMax/q/maxResults/pageToken); single-event lookup
// uses read-only `calendar.event.get1` with exact { calendarId, eventId }
// (verified by genuine live execution; see
// docs/phase1-api-execution-report.md). Only read operations are ever invoked.

const { ExternalIntegrationError, InternalServerError } = require('../../shared/errors/app-error');
const { normalizeOfficialEvent } = require('../../domain/event/event.model');

const SOURCE = 'google_calendar';

function createCalendarProvider({ client, logger, methodEvents, methodEvent, fetchLog }) {
  if (!client || typeof client.execute !== 'function') {
    throw new Error('CalendarProvider requires a SwytchcodeClient.');
  }
  if (typeof methodEvents !== 'string' || methodEvents === '') {
    throw new Error('CalendarProvider requires the events method id.');
  }
  if (typeof methodEvent !== 'string' || methodEvent === '') {
    throw new Error('CalendarProvider requires the single-event method id.');
  }
  const log = logger && logger.child ? logger.child({ component: 'calendar-provider' }) : logger;

  // Telemetry best-effort: a logging failure is recorded in the app log but
  // never fails the read itself (unlike audit records, this is observability,
  // not product evidence).
  async function noteFetch(outcome, errorCategory) {
    if (!fetchLog || typeof fetchLog.record !== 'function') return;
    try {
      await fetchLog.record({ outcome, errorCategory });
    } catch (err) {
      if (log) log.warn('fetch telemetry write failed', { outcome });
    }
  }

  async function runList({ calendarId, timeMin, timeMax, query, maxResults, pageToken, requestId }) {
    const fetchedAt = new Date().toISOString();
    let data;
    try {
      const result = await client.execute({
        tool: methodEvents,
        params: {
          calendarId,
          timeMin,
          timeMax,
          q: query,
          maxResults,
          pageToken,
          singleEvents: 'true',
          orderBy: 'startTime',
          timeZone: undefined,
        },
        requestId,
      });
      data = result.data;
      await noteFetch('success');
    } catch (err) {
      // A 404 on the events collection means the CALENDAR is unknown, which
      // is a server misconfiguration — never an unknown event.
      if (err && err.code === 'EVENT_NOT_FOUND') {
        await noteFetch('failure', 'CONFIGURATION_ERROR');
        throw new InternalServerError(
          'CONFIGURATION_ERROR',
          `The configured calendar "${calendarId}" was not found upstream. Check CALENDAR_ID.`
        );
      }
      await noteFetch('failure', (err && err.code) || 'unknown');
      throw err;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ExternalIntegrationError(
        'SWYTCHCODE_INVALID_RESPONSE',
        'The event source returned a malformed events collection.'
      );
    }
    // Google omits `items` entirely when a list is empty — that is valid.
    const items = data.items === undefined ? [] : data.items;
    if (!Array.isArray(items)) {
      throw new ExternalIntegrationError(
        'SWYTCHCODE_INVALID_RESPONSE',
        'The event source returned a malformed events collection.'
      );
    }
    const calendarTimeZone = typeof data.timeZone === 'string' ? data.timeZone : null;
    const events = [];
    const dropped = [];
    for (const item of items) {
      try {
        events.push(
          normalizeOfficialEvent(item, { source: SOURCE, calendarId, calendarTimeZone, fetchedAt })
        );
      } catch (err) {
        dropped.push({ id: item && typeof item.id === 'string' ? item.id : null });
      }
    }
    if (items.length > 0 && events.length === 0) {
      throw new ExternalIntegrationError(
        'SWYTCHCODE_INVALID_RESPONSE',
        'None of the upstream events could be parsed.'
      );
    }
    if (dropped.length > 0 && log) {
      log.warn('dropped unparseable upstream events', {
        requestId: requestId || null, dropped: dropped.length, total: items.length,
      });
    }
    return {
      events,
      nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
      calendarTimeZone,
    };
  }

  async function listEvents(query = {}) {
    return runList({
      calendarId: query.calendarId,
      timeMin: query.timeMin,
      timeMax: query.timeMax,
      query: query.query,
      maxResults: query.maxResults,
      pageToken: query.pageToken,
      requestId: query.requestId,
    });
  }

  // Exact single-event retrieval — no time window, no pagination scan: an
  // event is found regardless of how far it sits from today or the draft.
  async function getEventById(query = {}) {
    const fetchedAt = new Date().toISOString();
    let data;
    try {
      const result = await client.execute({
        tool: methodEvent,
        params: { calendarId: query.calendarId, eventId: query.eventId },
        requestId: query.requestId,
      });
      data = result.data;
      await noteFetch('success');
    } catch (err) {
      // On the single-event method a 404 means the EVENT is unknown (the
      // calendar itself is proven by listing) — null, never thrown.
      if (err && err.code === 'EVENT_NOT_FOUND') {
        await noteFetch('failure', 'EVENT_NOT_FOUND');
        return null;
      }
      await noteFetch('failure', (err && err.code) || 'unknown');
      throw err;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ExternalIntegrationError(
        'SWYTCHCODE_INVALID_RESPONSE',
        'The event source returned a malformed event.'
      );
    }
    // Single-get carries no top-level timeZone; per-event zones still apply
    // and any UTC fallback keeps its provenance (never silently assumed).
    return normalizeOfficialEvent(data, {
      source: SOURCE, calendarId: query.calendarId, calendarTimeZone: null, fetchedAt,
    });
  }

  return { listEvents, getEventById };
}

module.exports = { createCalendarProvider };
