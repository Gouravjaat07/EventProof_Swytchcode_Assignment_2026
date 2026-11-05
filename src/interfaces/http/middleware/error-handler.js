'use strict';

// Central error translator: the ONLY place HTTP status codes and error
// envelopes are produced.
//
// - ApplicationError -> its code/status/message (+ safe details).
// - body-parser failures -> INVALID_REQUEST (malformed JSON) or
//   PAYLOAD_TOO_LARGE (over the byte limit).
// - anything else -> generic 500; full diagnostics go to the log with the
//   request id, never to the client. Stack traces reach logs only outside
//   production.

const { isApplicationError } = require('../../../shared/errors/app-error');

function errorHandler({ logger, nodeEnv = 'development' } = {}) {
  // eslint-disable-next-line no-unused-vars
  return function handleError(err, req, res, next) {
    const requestId = req.id || null;

    if (err && err.type === 'entity.too.large') {
      res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit.', requestId },
      });
      return;
    }
    if (err && err.type === 'entity.parse.failed') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Request body is not valid JSON.', requestId },
      });
      return;
    }

    if (isApplicationError(err)) {
      const body = { success: false, error: { ...err.toJSON(), requestId } };
      res.status(err.status).json(body);
      if (logger) {
        const level = err.status >= 500 ? 'error' : 'warn';
        logger[level]('request failed', { requestId, code: err.code, status: err.status });
      }
      return;
    }

    if (logger) {
      const fields = { requestId, err };
      if (nodeEnv !== 'production' && err && err.stack) fields.stack = String(err.stack);
      logger.error('unexpected error', fields);
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.', requestId },
    });
  };
}

module.exports = { errorHandler };
