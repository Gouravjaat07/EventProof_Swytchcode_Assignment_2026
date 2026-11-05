'use strict';

const { Router } = require('express');
const { createHealthController } = require('../controllers/health.controller');
const { createEventsController } = require('../controllers/events.controller');
const { createVerificationsController } = require('../controllers/verifications.controller');
const { createIntegrationsController } = require('../controllers/integrations.controller');

function createV1Router({ config, fetchEventsService, verifyService, auditRepository, historyService, integrationService }) {
  const router = Router();
  const health = createHealthController({ config });
  const events = createEventsController({ fetchEventsService });
  const verifications = createVerificationsController({ verifyService, auditRepository, historyService });
  const integrations = createIntegrationsController({ integrationService });

  router.get('/health', health.getHealth);
  router.get('/events', events.listEvents);
  router.get('/events/:eventId', events.getEventById);
  router.post('/verifications', verifications.createVerification);
  // Static sub-paths first: Express matches in registration order.
  router.get('/verifications/stats', verifications.getVerificationStats);
  router.get('/verifications', verifications.listVerifications);
  router.get('/verifications/:verificationId', verifications.getVerification);
  router.get('/integrations/status', integrations.getStatus);

  return router;
}

module.exports = { createV1Router };
