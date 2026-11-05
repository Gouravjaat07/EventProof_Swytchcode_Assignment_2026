'use strict';

// Integration status endpoint: safe diagnostics only (no tokens, no paths,
// no environment values — the service already strips everything sensitive).

const { ok } = require('./respond');

function createIntegrationsController({ integrationService }) {
  async function getStatus(req, res) {
    ok(res, await integrationService.getStatus(), req);
  }

  return { getStatus };
}

module.exports = { createIntegrationsController };
