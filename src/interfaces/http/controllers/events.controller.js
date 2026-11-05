'use strict';

// Events endpoints. Thin by design: parameter transport only — all validation
// lives in the application service so HTTP and future callers share one site.

const { ok } = require('./respond');

function createEventsController({ fetchEventsService }) {
  async function listEvents(req, res) {
    const result = await fetchEventsService.listEvents({
      calendarId: req.query.calendarId,
      timeMin: req.query.timeMin,
      timeMax: req.query.timeMax,
      query: req.query.query,
      limit: req.query.limit,
      pageToken: req.query.pageToken,
    });
    ok(res, result, req);
  }

  async function getEventById(req, res) {
    // A cancelled event is still returned here (informational read); only
    // verification rejects cancellation.
    const event = await fetchEventsService.getEventById({
      calendarId: req.query.calendarId,
      eventId: req.params.eventId,
    });
    ok(res, { event }, req);
  }

  return { listEvents, getEventById };
}

module.exports = { createEventsController };
