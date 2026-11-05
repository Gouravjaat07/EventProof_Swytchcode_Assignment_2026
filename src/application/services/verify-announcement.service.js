'use strict';

// VerifyAnnouncementService: the Phase 1 core workflow.
//
//  1. Validate the announcement draft (invalid drafts throw 400/422 — they
//     never reach the engine as trusted input).
//  2. Fetch the authoritative event by exact id (no window: the draft date
//     being wrong is itself a mismatch case, never a lookup failure).
//  3. Reject unknown (404) and cancelled (409) events — never VERIFIED.
//  4. Run the deterministic engine; build the stable result contract.
//  5. Persist an audit record durably (failure throws AUDIT_STORAGE_UNAVAILABLE:
//     a result without its record would corrupt history and statistics).
//
// Every step is logged with request/verification ids; no secrets are logged.

const crypto = require('node:crypto');
const { NotFoundError, ConflictError, ValidationError, ServiceUnavailableError } = require('../../shared/errors/app-error');
const { validateAnnouncementDraft } = require('../../domain/announcement/announcement.model');
const { isCancelled } = require('../../domain/event/event.model');
const { verify } = require('../../domain/verification/engine');
const { buildVerificationResult } = require('../../domain/verification/result');

function createVerifyAnnouncementService({ eventSource, auditRepository, logger, config }) {
  if (!eventSource || typeof eventSource.getEventById !== 'function') {
    throw new Error('VerifyAnnouncementService requires an EventSourceProvider.');
  }
  if (!auditRepository || typeof auditRepository.save !== 'function') {
    throw new Error('VerifyAnnouncementService requires an AuditRepository.');
  }
  const log = logger.child ? logger.child({ service: 'verify-announcement' }) : logger;

  function normalizeEventId(value) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > 1024 || /\s/.test(value)) {
      throw new ValidationError('INVALID_EVENT_ID', 'Field "eventId" must be a non-empty string without whitespace.', {
        details: { field: 'eventId' },
      });
    }
    return value;
  }

  function normalizeCalendarId(value) {
    const raw = value === undefined || value === null || value === '' ? config.calendarId : value;
    if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 256 || /\s/.test(raw)) {
      throw new ValidationError('INVALID_REQUEST', 'Field "calendarId" must be a non-empty string without whitespace.', {
        details: { field: 'calendarId' },
      });
    }
    return raw;
  }

  async function verifyAnnouncement(input = {}) {
    const requestId = input.requestId || null;
    const eventId = normalizeEventId(input.eventId);
    const calendarId = normalizeCalendarId(input.calendarId);
    // Step 1: structural + semantic draft validation (throws on any defect).
    const draft = validateAnnouncementDraft(input.announcement);

    // Step 2: authoritative fetch by exact id (window-free).
    const startedAt = Date.now();
    const official = await eventSource.getEventById({ calendarId, eventId });
    log.info('authoritative event fetched', {
      requestId, eventId, calendarId, found: official !== null, durationMs: Date.now() - startedAt,
    });

    // Step 3: fail-closed gates.
    if (!official) {
      throw new NotFoundError('EVENT_NOT_FOUND', 'The requested official event could not be found.');
    }
    if (isCancelled(official)) {
      throw new ConflictError(
        'EVENT_CANCELLED',
        'The official event is cancelled; the announcement must not be published as-is.'
      );
    }

    // Step 4: deterministic comparison + stable result.
    const { status, fieldResults, summary } = verify(official, draft, { venueAliases: config.venueAliases });
    const result = buildVerificationResult({
      verificationId: crypto.randomUUID(),
      status,
      eventReference: {
        source: official.source,
        sourceEventId: official.sourceEventId,
        fetchedAt: official.fetchedAt,
        sourceUpdatedAt: official.sourceUpdatedAt,
      },
      fieldResults,
      summary,
      verifiedAt: new Date().toISOString(),
    });
    log.info('verification decided', {
      requestId, verificationId: result.verificationId, status, eventId,
      matchingFields: summary.matchingFields, mismatchingFields: summary.mismatchingFields,
    });

    // Step 5: durable audit persistence. Phase 2 requires history to survive
    // restarts, so a verification WITHOUT its record would corrupt history
    // and statistics — the failure is loud (503), never silent.
    try {
      await auditRepository.save({ ...result, requestId });
    } catch (err) {
      log.error('audit persistence failed', { requestId, verificationId: result.verificationId, err });
      throw new ServiceUnavailableError(
        'AUDIT_STORAGE_UNAVAILABLE',
        'The verification could not be recorded; no result is returned without durable evidence.'
      );
    }
    return result;
  }

  return { verify: verifyAnnouncement };
}

module.exports = { createVerifyAnnouncementService };
