'use strict';

// Verifications endpoints. POST creates a verification (201 + Location);
// GET replays the stored audit record verbatim (404 when unknown — history is
// never fabricated).

const { NotFoundError } = require('../../../shared/errors/app-error');
const { APPLICATION } = require('../../../config/application');
const { ok, created } = require('./respond');

function createVerificationsController({ verifyService, auditRepository, historyService }) {
  async function createVerification(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await verifyService.verify({
      eventId: body.eventId,
      calendarId: body.calendarId,
      announcement: body.announcement,
      requestId: req.id || null,
    });
    created(res, result, req, `${APPLICATION.apiPrefix}/verifications/${result.verificationId}`);
  }

  async function getVerification(req, res) {
    const record = await auditRepository.getById(req.params.verificationId);
    if (!record) {
      throw new NotFoundError('VERIFICATION_NOT_FOUND', 'The requested verification record was not found.');
    }
    ok(res, record, req);
  }

  async function listVerifications(req, res) {
    const result = await historyService.listVerifications({
      status: req.query.status,
      q: req.query.q,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      pageSize: req.query.pageSize,
      sort: req.query.sort,
    });
    ok(res, result, req);
  }

  async function getVerificationStats(req, res) {
    ok(res, await historyService.getStats(), req);
  }

  return { createVerification, getVerification, listVerifications, getVerificationStats };
}

module.exports = { createVerificationsController };
