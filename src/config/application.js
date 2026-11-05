'use strict';

// Static application constants (not environment-dependent).

const path = require('node:path');

function appVersion() {
  try {
    // eslint-disable-next-line global-require
    const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const APPLICATION = Object.freeze({
  name: 'eventproof',
  version: appVersion(),
  apiPrefix: '/api/v1',
  jsonBodyLimit: '256kb',
  // Fields the verification engine compares, in output order.
  verificationFields: Object.freeze([
    'title',
    'eventDate',
    'startTime',
    'endTime',
    'timeZone',
    'venue',
    'registrationUrl',
  ]),
  // Fields that must MATCH for a VERIFIED decision.
  criticalFields: Object.freeze(['title', 'eventDate', 'startTime', 'venue']),
});

module.exports = { APPLICATION };
