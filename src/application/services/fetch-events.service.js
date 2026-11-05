'use strict';

// FetchEventsService: validated read access to authoritative events.
// Owns input validation; the provider owns API mechanics (listing stays
// time-windowed, single-id lookup is an exact fetch with no window).

const { ValidationError, NotFoundError } = require('../../shared/errors/app-error');

const MAX_EVENT_ID_LENGTH = 1024;
const MAX_CALENDAR_ID_LENGTH = 256;
const MAX_QUERY_LENGTH = 256;
const MAX_PAGE_TOKEN_LENGTH = 2048;

function invalid(field, message, code = 'INVALID_REQUEST') {
  return new ValidationError(code, message, { details: { field } });
}

function normalizeCalendarId(value, fallback) {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > MAX_CALENDAR_ID_LENGTH || /\s/.test(raw)) {
    throw invalid('calendarId', 'Field "calendarId" must be a non-empty string without whitespace.');
  }
  return raw;
}

function normalizeEventId(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > MAX_EVENT_ID_LENGTH || /\s/.test(value)) {
    throw new ValidationError('INVALID_EVENT_ID', 'Field "eventId" must be a non-empty string without whitespace.', {
      details: { field: 'eventId' },
    });
  }
  return value;
}

function parseLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+$/.test(text)) {
    throw invalid('limit', 'Field "limit" must be an integer.');
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1 || n > 250) {
    throw invalid('limit', 'Field "limit" must be an integer between 1 and 250.');
  }
  return n;
}

function parseInstant(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw invalid(field, `Field "${field}" must be an ISO-8601 date-time string.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ValidationError('INVALID_DATE', `Field "${field}" must be a valid ISO-8601 date-time.`, {
      details: { field },
    });
  }
  return new Date(ms).toISOString();
}

function normalizeQuery(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) {
    throw invalid('query', `Field "query" must be a string of at most ${MAX_QUERY_LENGTH} characters.`);
  }
  return value;
}

function normalizePageToken(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > MAX_PAGE_TOKEN_LENGTH) {
    throw invalid('pageToken', `Field "pageToken" must be a string of at most ${MAX_PAGE_TOKEN_LENGTH} characters.`);
  }
  return value;
}

function createFetchEventsService({ eventSource, logger, config }) {
  if (!eventSource || typeof eventSource.listEvents !== 'function' || typeof eventSource.getEventById !== 'function') {
    throw new Error('FetchEventsService requires an EventSourceProvider.');
  }
  const log = logger && logger.child ? logger.child({ service: 'fetch-events' }) : logger || console;

  async function listEvents(input = {}) {
    const calendarId = normalizeCalendarId(input.calendarId, config.calendarId);
    const timeMin = parseInstant(input.timeMin, 'timeMin');
    const timeMax = parseInstant(input.timeMax, 'timeMax');
    if (timeMin && timeMax && timeMin > timeMax) {
      throw new ValidationError('INVALID_DATE', 'Field "timeMin" must not be after "timeMax".', {
        details: { field: 'timeMin' },
      });
    }
    if (timeMin && timeMax && Date.parse(timeMax) - Date.parse(timeMin) > config.eventsMaxRangeDays * 86400000) {
      throw new ValidationError(
        'INVALID_DATE',
        `The requested range exceeds ${config.eventsMaxRangeDays} days.`,
        { details: { field: 'timeMax' } }
      );
    }
    const result = await eventSource.listEvents({
      calendarId,
      timeMin,
      timeMax,
      query: normalizeQuery(input.query),
      maxResults: parseLimit(input.limit, config.eventsMaxResults),
      pageToken: normalizePageToken(input.pageToken),
    });
    log.debug('events listed', { calendarId, count: result.events.length });
    return { events: result.events, nextPageToken: result.nextPageToken ?? null, calendarId };
  }

  async function getEventById(input = {}) {
    const calendarId = normalizeCalendarId(input.calendarId, config.calendarId);
    const eventId = normalizeEventId(input.eventId);
    const event = await eventSource.getEventById({ calendarId, eventId });
    if (!event) {
      throw new NotFoundError('EVENT_NOT_FOUND', 'The requested official event could not be found.');
    }
    return event;
  }

  return { listEvents, getEventById };
}

module.exports = { createFetchEventsService };
