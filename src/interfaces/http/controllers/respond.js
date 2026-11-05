'use strict';

// Success envelope: { success: true, data, meta: { requestId, ...extra } }.
// (Error envelopes live in middleware/error-handler.js.)

function ok(res, data, req, extraMeta) {
  res.status(200).json({ success: true, data, meta: { requestId: req.id || null, ...extraMeta } });
}

function created(res, data, req, location) {
  if (location) res.setHeader('Location', location);
  res.status(201).json({ success: true, data, meta: { requestId: req.id || null } });
}

module.exports = { ok, created };
