// Centralized backend client — the ONLY module that calls fetch().
// Responsibilities: base-URL resolution, timeout + abort, envelope parsing,
// error normalization, request-id propagation. Components never touch fetch.

const DEFAULT_TIMEOUT_MS = 30000;
const API_BASE_KEY = 'ep-api-base';

export class ApiError extends Error {
  constructor({ message, code, status, requestId, details }) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN_ERROR';
    this.status = status ?? null;
    this.requestId = requestId || null;
    this.details = details;
  }
}

// User-facing message per backend code. Unknown codes fall back to the
// server's own message (safe by backend contract) or a generic line.
const CODE_MESSAGES = {
  EVENT_NOT_FOUND: 'The official event could not be found. Check the event ID and calendar.',
  EVENT_CANCELLED: 'The official event is cancelled. The announcement must not be published as-is.',
  EVENT_SOURCE_UNAVAILABLE: 'The event source is unreachable right now. Retry in a bit.',
  EVENT_SOURCE_TIMEOUT: 'The event source took too long to respond. Retry in a bit.',
  EVENT_SOURCE_RATE_LIMITED: 'The event source rate-limited us. Wait a moment, then retry.',
  EVENT_SOURCE_PERMISSION_DENIED: 'Access to the calendar was denied. Check sharing settings.',
  AUTH_REQUIRED: 'Calendar authorization is required. Connect the provider, then retry.',
  AUTH_EXPIRED: 'Calendar authorization expired. Reconnect the provider, then retry.',
  SWYTCHCODE_NOT_INSTALLED: 'The Swytchcode CLI is missing on the server.',
  SWYTCHCODE_OPERATION_NOT_FOUND: 'Server misconfiguration: the calendar tool is not enabled.',
  SWYTCHCODE_INVALID_RESPONSE: 'The event source returned an unreadable response.',
  SWYTCHCODE_SIMULATED_DATA: 'Refused simulated data: no live authoritative record available.',
  SWYTCHCODE_POLICY_BLOCKED: 'A Swytchcode policy blocked this request.',
  SWYTCHCODE_APPROVAL_REQUIRED: 'This request is waiting for human approval.',
  INVALID_REQUEST: 'The request was malformed. Check the highlighted fields.',
  INVALID_EVENT_ID: 'That event ID is invalid. Paste the exact source identifier.',
  INVALID_DATE: 'That date is not a real calendar date.',
  INVALID_TIME: 'That time is invalid. Use HH:MM or h:MM AM/PM.',
  INVALID_TIMEZONE: 'That time zone is not a valid IANA name (e.g. Asia/Kolkata).',
  INVALID_REGISTRATION_URL: 'That registration URL is invalid (http/https, no credentials).',
  MISSING_REQUIRED_FIELD: 'A required field is missing.',
  PAYLOAD_TOO_LARGE: 'The request is too large.',
  VERIFICATION_NOT_FOUND: 'That verification record does not exist.',
  AUDIT_STORAGE_UNAVAILABLE: 'History storage is unavailable. The result was not recorded.',
  RATE_LIMIT_EXCEEDED: 'Too many requests. Slow down and retry.',
  NOT_FOUND: 'Not found.',
  CONFIGURATION_ERROR: 'Server misconfiguration. Contact the operator.',
  INTERNAL_SERVER_ERROR: 'Something went wrong on the server.',
};

export function userMessageFor(error) {
  if (error instanceof ApiError) {
    return CODE_MESSAGES[error.code] || error.message || 'Something went wrong.';
  }
  if (error && error.name === 'AbortError') return 'The request was cancelled.';
  return 'Could not reach the server. Is the backend running?';
}

export function getStoredBaseOverride() {
  try {
    return window.localStorage.getItem(API_BASE_KEY) || '';
  } catch {
    return '';
  }
}

export function setStoredBaseOverride(value) {
  try {
    if (!value) window.localStorage.removeItem(API_BASE_KEY);
    else window.localStorage.setItem(API_BASE_KEY, value);
  } catch {
    // Private-mode storage failure: just don't persist.
  }
}

export function resolveBaseUrl() {
  const override = getStoredBaseOverride().trim().replace(/\/+$/, '');
  if (override) return override;
  const env = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return env; // '' = same origin (Vite dev proxy forwards /api)
}

function buildUrl(path, query) {
  const base = resolveBaseUrl();
  const url = new URL(`${base}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  // Same-origin: return path-only so no absolute URL leaks into logs/traces.
  return base ? url.toString() : `${url.pathname}${url.search}`;
}

export async function apiRequest(path, { method = 'GET', body, query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw signal.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError');
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    let res;
    try {
      res = await fetch(buildUrl(path, query), {
        method,
        signal: controller.signal,
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        if (signal && signal.aborted) throw err;
        throw new ApiError({ message: 'The server took too long to respond.', code: 'REQUEST_TIMEOUT', status: null });
      }
      throw new ApiError({ message: 'Could not reach the server.', code: 'NETWORK_ERROR', status: null });
    }
    const requestId = res.headers.get('x-request-id');
    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ApiError({ message: 'The server returned an unreadable response.', code: 'BAD_RESPONSE', status: res.status, requestId });
      }
    }
    if (!res.ok || !payload || payload.success !== true) {
      const errBody = payload && payload.error ? payload.error : null;
      throw new ApiError({
        message: (errBody && errBody.message) || `Request failed (HTTP ${res.status}).`,
        code: (errBody && errBody.code) || 'UNKNOWN_ERROR',
        status: res.status,
        requestId: (errBody && errBody.requestId) || requestId,
        details: errBody ? errBody.details : undefined,
      });
    }
    return { data: payload.data, requestId };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// Typed endpoint wrappers (backend remains the single source of truth).
export const api = {
  health: (opts) => apiRequest('/api/v1/health', opts),
  listEvents: (query, opts) => apiRequest('/api/v1/events', { ...opts, query }),
  getEvent: (eventId, query, opts) =>
    apiRequest(`/api/v1/events/${encodeURIComponent(eventId)}`, { ...opts, query }),
  createVerification: (payload, opts) =>
    apiRequest('/api/v1/verifications', { ...opts, method: 'POST', body: payload }),
  getVerification: (id, opts) =>
    apiRequest(`/api/v1/verifications/${encodeURIComponent(id)}`, opts),
  listVerifications: (query, opts) => apiRequest('/api/v1/verifications', { ...opts, query }),
  verificationStats: (opts) => apiRequest('/api/v1/verifications/stats', opts),
  integrationStatus: (opts) => apiRequest('/api/v1/integrations/status', opts),
};
