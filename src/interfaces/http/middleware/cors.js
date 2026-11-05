'use strict';

// Exact-match CORS allowlist. When no origins are configured, no CORS headers
// are emitted (same-origin only). Matching origins get permissive
// simple-request headers; preflights short-circuit with 204. Credentials are
// never allowed (the API uses no cookies).

const ALLOW_METHODS = 'GET, POST, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, X-Request-Id';
const MAX_AGE = '600';

function corsMiddleware(allowedOrigins = []) {
  const allowlist = new Set(allowedOrigins);
  return function cors(req, res, next) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowlist.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
      res.setHeader('Access-Control-Max-Age', MAX_AGE);
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    } else if (req.method === 'OPTIONS' && req.path !== undefined) {
      // Unknown-origin preflight: answer without allow headers so browsers
      // block it, instead of leaking route existence via 404.
      res.status(204).end();
      return;
    }
    next();
  };
}

module.exports = { corsMiddleware };
