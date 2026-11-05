'use strict';

const { statusFor } = require('./codes');

// Base class for all expected application failures.
//
// - `code` is a stable machine-readable key from codes.js.
// - `message` is safe to show to API clients (never put secrets in it).
// - `details` is an optional JSON-safe object with safe diagnostic hints.
// - `cause` is for internal diagnostics only and is NEVER serialized to clients.
class ApplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.status = options.status || statusFor(code);
    if (options.details !== undefined) this.details = options.details;
  }

  // What API clients receive. Deliberately excludes `cause` and `stack`.
  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

class ValidationError extends ApplicationError {}
class AuthenticationError extends ApplicationError {}
class AuthorizationError extends ApplicationError {}
class NotFoundError extends ApplicationError {}
class ConflictError extends ApplicationError {}
class ExternalIntegrationError extends ApplicationError {}
class UpstreamTimeoutError extends ExternalIntegrationError {}
class RateLimitError extends ApplicationError {}
class ServiceUnavailableError extends ApplicationError {}
class InternalServerError extends ApplicationError {}

function isApplicationError(err) {
  return err instanceof ApplicationError;
}

module.exports = {
  ApplicationError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ExternalIntegrationError,
  UpstreamTimeoutError,
  RateLimitError,
  ServiceUnavailableError,
  InternalServerError,
  isApplicationError,
};
