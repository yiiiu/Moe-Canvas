export const PROVIDER_ERROR_CODES = Object.freeze({
  PROVIDER_CONFIG_MISSING: 'PROVIDER_CONFIG_MISSING',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  PROVIDER_RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_BAD_RESPONSE: 'PROVIDER_BAD_RESPONSE',
  PROVIDER_TASK_FAILED: 'PROVIDER_TASK_FAILED',
  PROVIDER_NOT_IMPLEMENTED: 'PROVIDER_NOT_IMPLEMENTED',
  PROVIDER_ALREADY_REGISTERED: 'PROVIDER_ALREADY_REGISTERED',
  PROVIDER_NOT_FOUND: 'PROVIDER_NOT_FOUND',
  PROVIDER_INVALID_ADAPTER: 'PROVIDER_INVALID_ADAPTER',
});

export class ProviderError extends Error {
  constructor(code, message = '', details = {}) {
    super(message || code);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details && typeof details === 'object' ? details : {};
  }
}

export function createProviderError(code, message = '', details = {}) {
  return new ProviderError(code, message, details);
}

export function isProviderError(error, code = '') {
  if (!(error instanceof ProviderError)) return false;
  return code ? error.code === code : true;
}