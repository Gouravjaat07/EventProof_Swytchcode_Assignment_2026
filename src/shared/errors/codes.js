'use strict';

// Central error-code registry. Every code maps to its HTTP status.
// Only codes actually thrown somewhere in src/ may be listed here.

const ERROR_CODES = Object.freeze({
  // Configuration (server operator must fix; never a client bug)
  CONFIGURATION_ERROR: 500,

  // Authentication / authorization
  AUTH_REQUIRED: 401,
  AUTH_EXPIRED: 401,

  // Swytchcode integration
  SWYTCHCODE_NOT_INSTALLED: 503,
  SWYTCHCODE_EXECUTION_FAILED: 502,
  SWYTCHCODE_OPERATION_NOT_FOUND: 500,
  SWYTCHCODE_INVALID_RESPONSE: 502,
  SWYTCHCODE_SIMULATED_DATA: 502,
  SWYTCHCODE_POLICY_BLOCKED: 403,
  SWYTCHCODE_APPROVAL_REQUIRED: 409,

  // Event source
  EVENT_NOT_FOUND: 404,
  EVENT_CANCELLED: 409,
  EVENT_SOURCE_UNAVAILABLE: 503,
  EVENT_SOURCE_TIMEOUT: 504,
  EVENT_SOURCE_RATE_LIMITED: 429,
  EVENT_SOURCE_PERMISSION_DENIED: 403,

  // Request validation: 400 = malformed shape/type, 422 = well-formed but semantically invalid
  INVALID_REQUEST: 400,
  INVALID_EVENT_ID: 400,
  INVALID_DATE: 422,
  INVALID_TIME: 422,
  INVALID_TIMEZONE: 422,
  INVALID_REGISTRATION_URL: 422,
  MISSING_REQUIRED_FIELD: 400,
  PAYLOAD_TOO_LARGE: 413,

  // Verification
  VERIFICATION_FAILED: 500,
  VERIFICATION_NOT_FOUND: 404,
  AUDIT_STORAGE_UNAVAILABLE: 503,

  // Infrastructure
  RATE_LIMIT_EXCEEDED: 429,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
});

function statusFor(code) {
  return Object.prototype.hasOwnProperty.call(ERROR_CODES, code)
    ? ERROR_CODES[code]
    : ERROR_CODES.INTERNAL_SERVER_ERROR;
}

module.exports = { ERROR_CODES, statusFor };
