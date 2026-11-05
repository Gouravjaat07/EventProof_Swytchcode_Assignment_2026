'use strict';

// Fixed-window in-memory rate limiter (per client IP).
//
// Deterministic and dependency-free. Limitations (documented, accepted for
// Phase 1): single-process state (not shared across instances), clients
// behind NAT share a bucket, and `trust proxy` stays disabled so the key is
// always the direct peer address. A distributed deployment must replace this
// with a shared store.

const { RateLimitError } = require('../../../shared/errors/app-error');

const SWEEP_INTERVAL_REQUESTS = 1000;
const MAX_BUCKETS_BEFORE_SWEEP = 5000;

function rateLimit({ max, windowMs }) {
  const buckets = new Map(); // ip -> { count, resetAt }
  let sinceSweep = 0;

  function sweep(now) {
    for (const [ip, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
    sinceSweep = 0;
  }

  return function limit(req, res, next) {
    const now = Date.now();
    sinceSweep += 1;
    if (sinceSweep >= SWEEP_INTERVAL_REQUESTS || buckets.size > MAX_BUCKETS_BEFORE_SWEEP) sweep(now);

    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(new RateLimitError('RATE_LIMIT_EXCEEDED', 'Too many requests; slow down and retry.', {
        details: { retryAfterSeconds: retryAfter },
      }));
      return;
    }
    next();
  };
}

module.exports = { rateLimit };
