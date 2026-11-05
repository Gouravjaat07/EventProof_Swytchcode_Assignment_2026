'use strict';

// EventSourceProvider port: boundary between application services and any
// authoritative event origin (Google Calendar via Swytchcode today, another
// source tomorrow). Services depend ONLY on this interface.
//
// listEvents(query) -> Promise<{ events, nextPageToken, calendarTimeZone }>
//   query: { calendarId, timeMin?, timeMax?, query?, maxResults?, pageToken?, timeZone? }
//   events: OfficialEvent[] (already normalized); nextPageToken: string|null.
//   Throws CONFIGURATION_ERROR when the calendar itself is unknown; never
//   throws EVENT_NOT_FOUND (an empty list is a valid answer).
//
// getEventById(query) -> Promise<OfficialEvent|null>
//   query: { calendarId, eventId }
//   Exact single-event retrieval (no time window, no scan); null when the
//   event does not exist. Cancelled events are RETURNED (with status
//   "cancelled") — the caller decides whether cancellation rejects the
//   operation.

class EventSourceProvider {
  async listEvents() {
    throw new Error('EventSourceProvider.listEvents is not implemented.');
  }

  async getEventById() {
    throw new Error('EventSourceProvider.getEventById is not implemented.');
  }
}

module.exports = { EventSourceProvider };
