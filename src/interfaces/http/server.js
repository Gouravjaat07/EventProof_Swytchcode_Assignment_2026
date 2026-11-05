'use strict';

// Composition root: validates config, wires dependencies, starts listening.
// Run: `node src/interfaces/http/server.js` (or `npm start`) from the repo root.
//
// - Binds HOST (default 127.0.0.1 — localhost-only until Phase 2 defines an
//   auth story for wider exposure).
// - Bounds every request at 60s (covers upstream timeout x attempts + margin).
// - SIGINT/SIGTERM drain in-flight requests, then force-exit after 10s.
// - Uncaught exceptions / unhandled rejections log and exit(1): the process
//   never limps on after an unrecoverable failure.

const path = require('node:path');
const { loadConfig } = require('../../config/env');
const { APPLICATION } = require('../../config/application');
const { createLogger } = require('../../shared/logging/logger');
const { createSwytchcodeClient } = require('../../infrastructure/swytchcode/swytchcode.client');
const { createCalendarProvider } = require('../../infrastructure/swytchcode/calendar.provider');
const { createCliProbe } = require('../../infrastructure/swytchcode/cli-probe');
const { openDatabase } = require('../../infrastructure/repositories/sqlite');
const { createSQLiteAuditRepository } = require('../../infrastructure/repositories/sqlite-audit.repository');
const { createSQLiteFetchLog } = require('../../infrastructure/repositories/sqlite-fetch-log');
const { createFetchEventsService } = require('../../application/services/fetch-events.service');
const { createVerifyAnnouncementService } = require('../../application/services/verify-announcement.service');
const { createHistoryService } = require('../../application/services/history.service');
const { createIntegrationService } = require('../../application/services/integration.service');
const { createApp } = require('./app');

const REQUEST_TIMEOUT_MS = 60000;
const SHUTDOWN_GRACE_MS = 10000;

// Builds the full production wiring WITHOUT listening, so composition (config,
// SDK load, dependency graph) is testable even where binding is impossible.
function compose(projectRoot) {
  const root = projectRoot || path.join(__dirname, '..', '..', '..');
  const config = loadConfig({ projectRoot: root });
  const logger = createLogger({ level: config.logLevel, service: APPLICATION.name });

  if (config.swytchcodeBin) process.env.SWYTCHCODE_BIN = config.swytchcodeBin;

  const swytchcodeClient = createSwytchcodeClient({
    logger,
    timeoutMs: config.swytchcodeTimeoutMs,
    maxAttempts: config.swytchcodeMaxAttempts,
    projectDir: config.swytchcodeProjectDir,
  });
  // Durable audit store. openDatabase throws on any failure (missing dir,
  // locked/corrupt file, failed migration) — startup aborts loudly rather
  // than running with fake-durable history. No in-memory fallback.
  const db = openDatabase(config.auditDbPath, root);
  const auditRepository = createSQLiteAuditRepository({ db, logger });
  const fetchLog = createSQLiteFetchLog({ db });
  const eventSource = createCalendarProvider({
    client: swytchcodeClient,
    logger,
    methodEvents: config.swytchcodeMethodEvents,
    methodEvent: config.swytchcodeMethodEvent,
    fetchLog,
  });
  const fetchEventsService = createFetchEventsService({ eventSource, logger, config });
  const verifyService = createVerifyAnnouncementService({ eventSource, auditRepository, logger, config });
  const historyService = createHistoryService({ auditRepository, logger });
  const integrationService = createIntegrationService({
    probe: createCliProbe(),
    fetchLog,
    logger,
    config,
  });
  const app = createApp({ config, fetchEventsService, verifyService, auditRepository, historyService, integrationService, logger });
  return { config, logger, app, eventSource, fetchEventsService, verifyService, auditRepository, historyService, integrationService, db };
}

function main() {
  const { config, logger, app, db } = compose();
  const server = app.listen(config.port, config.host, () => {
    logger.info('eventproof listening', {
      host: config.host, port: config.port, version: APPLICATION.version,
      node: process.version, swytchcodeMethod: config.swytchcodeMethodEvents,
    });
    logger.info('audit retention', { persistent: true, dbPath: config.auditDbPath });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown started', { signal });
    const force = setTimeout(() => {
      logger.error('shutdown forced after grace period', {});
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close(() => {
      try {
        db.close();
      } catch (err) {
        logger.error('database close failed', { err });
      }
      logger.info('shutdown complete', {});
      process.exit(0);
    });
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception, exiting', { err });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection, exiting', { err: reason });
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`eventproof failed to start: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

module.exports = { main, compose };
