'use strict';

// Liveness probe. Deliberately performs NO upstream calls: it answers from
// local state only. `swytchcode.configured` reports config presence (a tool
// id is set), never live connectivity — claiming otherwise would be a lie.

const { ok } = require('./respond');
const { APPLICATION } = require('../../../config/application');

const startedAt = Date.now();

function createHealthController({ config }) {
  async function getHealth(req, res) {
    ok(res, {
      status: 'ok',
      service: APPLICATION.name,
      version: APPLICATION.version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      swytchcode: {
        configured: typeof config.swytchcodeMethodEvents === 'string' && config.swytchcodeMethodEvents !== '',
      },
    }, req);
  }
  return { getHealth };
}

module.exports = { createHealthController };
