'use strict';

// SwytchcodeClient: the ONLY module allowed to invoke Swytchcode.
//
// Transport: the documented `@swytchcode/runtime` `exec()` (spawns
// `swytchcode exec <tool> --json` with a JSON stdin payload). The executor is
// constructor-injected so tests stub it; production passes the real SDK.
//
// Responsibilities:
//  - validate tool ids and coerce params (tool ids come from OUR config —
//    user input never becomes a command argument; values travel via stdin).
//  - enforce an explicit timeout on every call (never wait forever).
//  - REJECT simulated/demo payloads: a response flagged demo/_simulated is
//    refused as SWYTCHCODE_SIMULATED_DATA, because demo data must never
//    masquerade as an authoritative record (the SDK's own stderr guard misses
//    the real "demo mode" banner text — verified against CLI 2.25.5 — so this
//    client guards the parsed payload instead).
//  - translate CLI exit codes / classified errors / in-200 provider errors
//    into stable domain errors.
//  - bounded retries (attempt cap + exponential backoff + jitter) for
//    transient failures only. Auth, policy, validation, and not-found
//    failures never retry.
//  - return { data, meta } with sanitized execution metadata (no bodies,
//    no credentials — only tool, attempts, duration, timestamp).

const {
  AuthenticationError,
  AuthorizationError,
  ExternalIntegrationError,
  InternalServerError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  isApplicationError,
} = require('../../shared/errors/app-error');

const TOOL_ID_RE = /^[A-Za-z0-9_.-]{1,256}$/;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;
const MAX_BACKOFF_MS = 4000;
const MAX_JITTER_MS = 250;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

function defaultSleeper(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt, baseMs) {
  const exp = Math.min(baseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return exp + Math.floor(Math.random() * MAX_JITTER_MS);
}

// Query/path params must be scalars; null/undefined/"" are dropped (they are
// never meaningful to a provider and empty strings break strict APIs).
function coerceParams(params, field) {
  if (params === undefined || params === null) return undefined;
  if (!isPlainObject(params)) {
    throw new InternalServerError('CONFIGURATION_ERROR', `Swytchcode "${field}" must be a plain object.`);
  }
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
    } else {
      throw new InternalServerError(
        'CONFIGURATION_ERROR',
        `Swytchcode "${field}.${k}" must be a string, number, or boolean.`
      );
    }
  }
  return out;
}

function sdkDetails(err) {
  return err && isPlainObject(err.details) ? err.details : null;
}

// Map a numeric CLI exit code (documented in `swy exec --help` / exec guide).
function errorForExitCode(code, message, details) {
  const safe = details ? { details } : undefined;
  switch (code) {
    case 2:
      return {
        error: new InternalServerError('SWYTCHCODE_OPERATION_NOT_FOUND', message, safe),
        retryable: false,
      };
    case 3:
      if (/expir/i.test(message)) {
        return { error: new AuthenticationError('AUTH_EXPIRED', message, safe), retryable: false };
      }
      return { error: new AuthenticationError('AUTH_REQUIRED', message, safe), retryable: false };
    case 4:
      return { error: new ServiceUnavailableError('EVENT_SOURCE_UNAVAILABLE', message, safe), retryable: true };
    case 6:
      return { error: new AuthorizationError('SWYTCHCODE_POLICY_BLOCKED', message, safe), retryable: false };
    case 7:
      return { error: new ConflictError('SWYTCHCODE_APPROVAL_REQUIRED', message, safe), retryable: false };
    default:
      return { error: new ExternalIntegrationError('SWYTCHCODE_EXECUTION_FAILED', message, safe), retryable: false };
  }
}

// Message/category sniffing for failures without a clean exit code.
function errorForMessage(message, details) {
  const safe = details ? { details } : undefined;
  const m = message || '';
  if (/ENOENT|not installed|is the CLI installed|Failed to spawn/i.test(m)) {
    return {
      error: new ServiceUnavailableError(
        'SWYTCHCODE_NOT_INSTALLED',
        'The Swytchcode CLI is not installed or not on PATH (set SWYTCHCODE_BIN).',
        safe
      ),
      retryable: false,
    };
  }
  if (/timed out|ETIMEDOUT|timeout/i.test(m)) {
    return { error: new UpstreamTimeoutError('EVENT_SOURCE_TIMEOUT', 'The event source timed out.', safe), retryable: true };
  }
  if (/not_found|tool .* is not configured|not configured in this project's tooling/i.test(m)) {
    return {
      error: new InternalServerError(
        'SWYTCHCODE_OPERATION_NOT_FOUND',
        'The required Swytchcode tool is not enabled in tooling.json.',
        safe
      ),
      retryable: false,
    };
  }
  if (/tenant_not_connected|not connected|unauthorized|unauthenticated|auth/i.test(m)) {
    if (/expir/i.test(m)) {
      return { error: new AuthenticationError('AUTH_EXPIRED', 'Swytchcode provider authorization expired; reconnect the provider.', safe), retryable: false };
    }
    return {
      error: new AuthenticationError('AUTH_REQUIRED', 'Swytchcode provider authorization is required; connect the provider.', safe),
      retryable: false,
    };
  }
  if (/rate.?limit|too many requests|429/i.test(m)) {
    return { error: new RateLimitError('EVENT_SOURCE_RATE_LIMITED', 'The event source rate-limited the request.', safe), retryable: true };
  }
  if (/policy|blocked by/i.test(m)) {
    return { error: new AuthorizationError('SWYTCHCODE_POLICY_BLOCKED', 'Swytchcode policy blocked the execution.', safe), retryable: false };
  }
  if (/approv/i.test(m)) {
    return { error: new ConflictError('SWYTCHCODE_APPROVAL_REQUIRED', 'Swytchcode execution is waiting for human approval.', safe), retryable: false };
  }
  if (/network|ECONN|ENOTFOUND|socket|dial|TLS|certificate/i.test(m)) {
    return { error: new ServiceUnavailableError('EVENT_SOURCE_UNAVAILABLE', 'The event source could not be reached.', safe), retryable: true };
  }
  if (/permission|forbidden|denied|403/i.test(m)) {
    return { error: new AuthorizationError('EVENT_SOURCE_PERMISSION_DENIED', 'The event source denied permission for this request.', safe), retryable: false };
  }
  if (/not found|404/i.test(m)) {
    return { error: new NotFoundError('EVENT_NOT_FOUND', 'The requested official event could not be found.', safe), retryable: false };
  }
  return {
    error: new ExternalIntegrationError('SWYTCHCODE_EXECUTION_FAILED', 'Swytchcode execution failed.', safe),
    retryable: false,
  };
}

function mapExecutorError(err) {
  if (isApplicationError(err)) return { error: err, retryable: false };
  const message = err && typeof err.message === 'string' ? err.message : 'Swytchcode execution failed.';
  const details = sdkDetails(err);
  const passThrough = details
    ? { category: details.category, suggestedAction: details.suggestedAction, docsUrl: details.docsUrl }
    : undefined;
  // The SDK puts the numeric exit status in `cause` for non-zero exits.
  if (err && typeof err.cause === 'number' && Number.isInteger(err.cause)) {
    const mapped = errorForExitCode(err.cause, message, passThrough);
    if (details && details.retryable === true && mapped.retryable) return mapped;
    // A retryable hint never overrides a fail-closed class.
    if (details && details.retryable === true && /^(AUTH_|SWYTCHCODE_OPERATION_NOT_FOUND|SWYTCHCODE_POLICY_BLOCKED|SWYTCHCODE_APPROVAL_REQUIRED)/.test(mapped.error.code)) {
      return mapped;
    }
    if (details && details.retryable === true) return { error: mapped.error, retryable: true };
    return mapped;
  }
  const mapped = errorForMessage(message, passThrough);
  if (details && details.retryable === true && mapped.retryable) return mapped;
  if (details && details.retryable === true && mapped.error.code === 'SWYTCHCODE_EXECUTION_FAILED') {
    return { error: mapped.error, retryable: true };
  }
  return mapped;
}

// A provider answering 4xx/5xx still exits 0; the JSON carries status_code.
function mapProviderStatus(result) {
  const status = result.status_code;
  const category = typeof result.error_category === 'string' ? result.error_category : 'provider_error';
  const details = { category, providerStatus: status };
  if (status === 401) {
    return { error: new AuthenticationError('AUTH_EXPIRED', 'Swytchcode provider authorization expired; reconnect the provider.', { details }), retryable: false };
  }
  if (status === 403) {
    return { error: new AuthorizationError('EVENT_SOURCE_PERMISSION_DENIED', 'The event source denied permission for this request.', { details }), retryable: false };
  }
  if (status === 404) {
    return { error: new NotFoundError('EVENT_NOT_FOUND', 'The requested official event could not be found.', { details }), retryable: false };
  }
  if (status === 429) {
    return { error: new RateLimitError('EVENT_SOURCE_RATE_LIMITED', 'The event source rate-limited the request.', { details }), retryable: true };
  }
  if (status === 408) {
    return { error: new UpstreamTimeoutError('EVENT_SOURCE_TIMEOUT', 'The event source timed out.', { details }), retryable: true };
  }
  if (status >= 500) {
    return { error: new ServiceUnavailableError('EVENT_SOURCE_UNAVAILABLE', 'The event source is unavailable.', { details }), retryable: true };
  }
  return {
    error: new ExternalIntegrationError('SWYTCHCODE_EXECUTION_FAILED', `The provider rejected the request (HTTP ${status}).`, { details }),
    retryable: result.retryable === true,
  };
}

// Extract the provider payload from the CLI's JSON envelope. Observed shapes:
// documented `{ success: true, result: {...} }` and demo `{ demo, data }`
// (demo envelopes are rejected before extraction — see execute()).
function extractPayload(result) {
  if (!isPlainObject(result)) {
    throw new ExternalIntegrationError(
      'SWYTCHCODE_INVALID_RESPONSE',
      'Swytchcode returned a response that is not a JSON object.'
    );
  }
  if (result.success === false) {
    throw new ExternalIntegrationError('SWYTCHCODE_EXECUTION_FAILED', 'Swytchcode reported the execution as failed.');
  }
  if (typeof result.status_code === 'number' && result.status_code >= 400) {
    throw mapProviderStatus(result).error;
  }
  const payload = 'result' in result ? result.result : 'data' in result ? result.data : result;
  if (!isPlainObject(payload) && !Array.isArray(payload)) {
    throw new ExternalIntegrationError(
      'SWYTCHCODE_INVALID_RESPONSE',
      'Swytchcode returned a response without a usable payload.'
    );
  }
  return payload;
}

function createSwytchcodeClient(options = {}) {
  const executor = options.executor || require('@swytchcode/runtime').exec;
  const logger = options.logger && options.logger.child ? options.logger.child({ component: 'swytchcode-client' }) : options.logger;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const backoffBaseMs = options.backoffBaseMs || DEFAULT_BACKOFF_BASE_MS;
  const sleeper = options.sleeper || defaultSleeper;
  const projectDir = options.projectDir || process.cwd();

  async function execute({ tool, params, body, headers, requestId, timeout }) {
    if (typeof tool !== 'string' || !TOOL_ID_RE.test(tool)) {
      throw new InternalServerError('CONFIGURATION_ERROR', 'Invalid Swytchcode tool id (server misconfiguration).');
    }
    const stdin = {};
    const coercedParams = coerceParams(params, 'params');
    if (coercedParams) stdin.params = coercedParams;
    if (body !== undefined) {
      if (!isPlainObject(body)) throw new InternalServerError('CONFIGURATION_ERROR', 'Swytchcode "body" must be a plain object.');
      stdin.body = body;
    }
    const coercedHeaders = coerceParams(headers, 'headers');
    if (coercedHeaders) stdin.headers = coercedHeaders;

    const effectiveTimeout = timeout || timeoutMs;
    let lastError = null;
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let raw;
      try {
        raw = await executor(tool, stdin, { timeoutMs: effectiveTimeout, cwd: projectDir });
      } catch (err) {
        const mapped = mapExecutorError(err);
        lastError = mapped.error;
        if (logger) {
          logger.warn('swytchcode execution failed', {
            requestId: requestId || null, tool, attempt, maxAttempts,
            code: mapped.error.code, retryable: mapped.retryable,
          });
        }
        if (mapped.retryable && attempt < maxAttempts) {
          await sleeper(backoffDelay(attempt, backoffBaseMs));
          continue;
        }
        throw mapped.error;
      }

      // Demo/simulated guard: such payloads are never authoritative data.
      if (isPlainObject(raw) && (raw.demo === true || raw._simulated === true)) {
        throw new ExternalIntegrationError(
          'SWYTCHCODE_SIMULATED_DATA',
          'Swytchcode returned simulated demo data; refusing to treat it as an authoritative record.'
        );
      }

      let payload;
      try {
        payload = extractPayload(raw);
      } catch (err) {
        // Provider 429/5xx surface here as retryable errors.
        if (
          isApplicationError(err) &&
          (err.code === 'EVENT_SOURCE_RATE_LIMITED' || err.code === 'EVENT_SOURCE_UNAVAILABLE' || err.code === 'EVENT_SOURCE_TIMEOUT') &&
          attempt < maxAttempts
        ) {
          lastError = err;
          if (logger) logger.warn('provider error, retrying', { requestId: requestId || null, tool, attempt, code: err.code });
          await sleeper(backoffDelay(attempt, backoffBaseMs));
          continue;
        }
        throw err;
      }

      return {
        data: payload,
        meta: {
          tool, attempts: attempt, durationMs: Date.now() - startedAt, executedAt: new Date().toISOString(),
        },
      };
    }
    throw lastError || new ExternalIntegrationError('SWYTCHCODE_EXECUTION_FAILED', 'Swytchcode execution failed.');
  }

  return { execute };
}

module.exports = { createSwytchcodeClient };
