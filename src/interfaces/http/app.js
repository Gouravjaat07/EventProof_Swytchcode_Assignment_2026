'use strict';

// Express application factory. Builds (but never listens with) the app so
// tests inject requests without opening sockets. Wiring order is load-bearing:
// request id -> security headers -> CORS -> body parsing -> rate limit ->
// versioned routes -> 404 -> centralized errors.

const express = require('express');
const { APPLICATION } = require('../../config/application');
const { requestIdMiddleware } = require('./middleware/request-id');
const { securityHeaders } = require('./middleware/security-headers');
const { corsMiddleware } = require('./middleware/cors');
const { rateLimit } = require('./middleware/rate-limit');
const { notFound } = require('./middleware/not-found');
const { errorHandler } = require('./middleware/error-handler');
const { createV1Router } = require('./routes/v1');

function createApp({ config, fetchEventsService, verifyService, auditRepository, historyService, integrationService, logger }) {
  const app = express();
  app.disable('x-powered-by');
  // The rate limiter keys on the direct peer; enabling `trust proxy` would
  // let clients spoof X-Forwarded-For and dodge it. Revisit only behind a
  // trusted terminator with explicit `trust proxy` + limiter review.
  app.set('trust proxy', false);

  app.use(requestIdMiddleware(logger));
  app.use(securityHeaders({ isProduction: config.nodeEnv === 'production' }));
  app.use(corsMiddleware(config.corsOrigins));
  app.use(express.json({ limit: APPLICATION.jsonBodyLimit }));
  app.use(rateLimit({ max: config.rateLimitMax, windowMs: config.rateLimitWindowMs }));
  app.use(APPLICATION.apiPrefix, createV1Router({ config, fetchEventsService, verifyService, auditRepository, historyService, integrationService }));
  app.use(notFound);
  app.use(errorHandler({ logger, nodeEnv: config.nodeEnv }));

  return app;
}

module.exports = { createApp };
