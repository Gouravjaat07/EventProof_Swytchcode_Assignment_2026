'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHistoryService } = require('../../../src/application/services/history.service');
const { createIntegrationService } = require('../../../src/application/services/integration.service');
const { createInMemoryAuditRepository } = require('../../../src/infrastructure/repositories/audit.repository');

function silentLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {} };
  l.child = () => l;
  return l;
}

describe('HistoryService', () => {
  function setup() {
    const auditRepository = createInMemoryAuditRepository({ maxRecords: 100 });
    return { auditRepository, svc: createHistoryService({ auditRepository, logger: silentLogger() }) };
  }

  it('validates pagination, filters, and sort before querying', async () => {
    const { svc } = setup();
    await assert.rejects(() => svc.listVerifications({ page: '0' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(() => svc.listVerifications({ pageSize: '101' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(() => svc.listVerifications({ status: 'BOGUS' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(() => svc.listVerifications({ sort: 'sideways' }), (e) => e.code === 'INVALID_REQUEST');
    await assert.rejects(
      () => svc.listVerifications({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }),
      (e) => e.code === 'INVALID_DATE'
    );
    await assert.rejects(() => svc.listVerifications({ q: 'x'.repeat(257) }), (e) => e.code === 'INVALID_REQUEST');
  });

  it('returns pages with totals', async () => {
    const { auditRepository, svc } = setup();
    const mk = (id, status, at) => ({
      verificationId: id, status,
      eventReference: { source: 's', sourceEventId: `e-${id}`, fetchedAt: at, sourceUpdatedAt: null },
      summary: { totalFields: 1, matchingFields: 1, mismatchingFields: 0, unverifiableFields: 0 },
      fieldResults: [], verifiedAt: at, requestId: null,
    });
    await auditRepository.save(mk('a', 'VERIFIED', '2026-01-01T00:00:00.000Z'));
    await auditRepository.save(mk('b', 'VERIFIED', '2026-01-02T00:00:00.000Z'));
    const out = await svc.listVerifications({ page: 2, pageSize: 1 });
    assert.equal(out.total, 2);
    assert.equal(out.totalPages, 2);
    assert.equal(out.records[0].verificationId, 'a');
    assert.deepEqual(await svc.getStats(), { total: 2, verified: 2, reviewRequired: 0, unverifiable: 0 });
  });
});

describe('IntegrationService', () => {
  function setup(probe, fetchLog) {
    return createIntegrationService({
      probe: probe || {
        cliVersion: () => ({ available: true, version: '2.25.5' }),
        authStatus: () => ({ state: 'connected', checkedAt: '2026-01-01T00:00:00.000Z' }),
      },
      fetchLog: fetchLog === undefined ? {
        last: async () => ({ lastSuccessAt: '2026-01-02T00:00:00.000Z', lastFailureAt: null, lastErrorCategory: null, lastOutcomeAt: '2026-01-02T00:00:00.000Z' }),
      } : fetchLog,
      logger: silentLogger(),
      config: { swytchcodeMethodEvents: 'calendar.event.get' },
    });
  }

  it('reports the five conditions independently', async () => {
    const status = await setup().getStatus();
    assert.equal(status.backend, 'online');
    assert.equal(status.swytchcode.cliAvailable, true);
    assert.equal(status.swytchcode.cliVersion, '2.25.5');
    assert.equal(status.swytchcode.runtimeLoads, true);
    assert.equal(status.swytchcode.method, 'calendar.event.get');
    assert.equal(status.provider.auth, 'connected');
    assert.equal(status.provider.lastSuccessAt, '2026-01-02T00:00:00.000Z');
    assert.equal(status.provider.lastFailureAt, null);
  });

  it('degrades every probe failure to unknown (never throws, never guesses)', async () => {
    const status = await setup(
      {
        cliVersion: () => { throw new Error('spawn gone'); },
        authStatus: () => { throw new Error('lock denied'); },
      },
      { last: async () => { throw new Error('db gone'); } }
    ).getStatus();
    assert.equal(status.backend, 'online');
    assert.equal(status.swytchcode.cliAvailable, false);
    assert.equal(status.provider.auth, 'unknown');
    assert.equal(status.provider.lastSuccessAt, null);
    assert.equal(status.provider.lastErrorCategory, null);
  });
});
