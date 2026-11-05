'use strict';

// Request correlation: every request gets a fresh server-generated id
// (incoming X-Request-Id values are NOT trusted), exposed to clients via the
// X-Request-Id response header and attached as req.id / req.logger.

const crypto = require('node:crypto');

function requestIdMiddleware(logger) {
  return function requestId(req, res, next) {
    const id = crypto.randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    req.logger = logger && logger.child ? logger.child({ requestId: id }) : logger;
    next();
  };
}

module.exports = { requestIdMiddleware };
