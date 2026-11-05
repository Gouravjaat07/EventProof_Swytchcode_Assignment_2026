'use strict';

// IntegrationService: honest, safe diagnostics for the integrations page.
//
// Five distinct conditions are reported independently — a healthy local probe
// NEVER implies provider authorization:
//   backend: always "online" (a response proves it).
//   cliAvailable (+version): Swytchcode binary present.
//   runtimeLoads: the Node runtime package requires successfully.
//   providerAuth: connected | not_connected | unknown (probe-driven; unknown
//     whenever it cannot be genuinely determined).
//   lastSuccessAt/lastFailureAt/lastErrorCategory: from the fetch log (null
//     when no fetch has ever run — "Not yet verified", not "connected").
//
// getStatus() never throws for probe problems: every probe is individually
// guarded so one broken check cannot take down the status page.

function createIntegrationService({ probe, fetchLog, logger, config }) {
  if (!probe || typeof probe.cliVersion !== 'function' || typeof probe.authStatus !== 'function') {
    throw new Error('IntegrationService requires a CLI probe.');
  }
  const log = logger && logger.child ? logger.child({ service: 'integrations' }) : logger;

  function safeProbe(name, fn, fallback) {
    try {
      const out = fn();
      return out && typeof out.then === 'function' ? out.catch(() => fallback) : out;
    } catch (err) {
      if (log) log.warn('integration probe failed', { probe: name });
      return fallback;
    }
  }

  function runtimeLoads() {
    try {
      require.resolve('@swytchcode/runtime');
      return true;
    } catch {
      return false;
    }
  }

  async function getStatus() {
    const cli = safeProbe('cliVersion', () => probe.cliVersion(), { available: false, version: null });
    const auth = safeProbe('authStatus', () => probe.authStatus(), { state: 'unknown', checkedAt: new Date().toISOString() });
    const telemetry = fetchLog
      ? await safeProbe(
        'fetchLog',
        () => fetchLog.last(),
        { lastSuccessAt: null, lastFailureAt: null, lastErrorCategory: null, lastOutcomeAt: null }
      )
      : { lastSuccessAt: null, lastFailureAt: null, lastErrorCategory: null, lastOutcomeAt: null };

    return {
      backend: 'online',
      swytchcode: {
        cliAvailable: !!cli.available,
        cliVersion: cli.version || null,
        runtimeLoads: runtimeLoads(),
        method: config ? config.swytchcodeMethodEvents : null,
      },
      provider: {
        auth: auth.state || 'unknown',
        authCheckedAt: auth.checkedAt || null,
        lastSuccessAt: telemetry.lastSuccessAt,
        lastFailureAt: telemetry.lastFailureAt,
        lastErrorCategory: telemetry.lastErrorCategory,
      },
    };
  }

  return { getStatus };
}

module.exports = { createIntegrationService };
