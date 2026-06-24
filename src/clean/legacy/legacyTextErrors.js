export const LEGACY_TEXT_ERROR_CODES = Object.freeze({
  LEGACY_TEXT_BAD_RESULT: 'LEGACY_TEXT_BAD_RESULT',
  LEGACY_TEXT_EMPTY_RESULT: 'LEGACY_TEXT_EMPTY_RESULT',
});

export class LegacyTextResultError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LegacyTextResultError';
    this.code = code;
    this.details = details;
  }

  toLegacyResult() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      source: 'clean-runtime',
    };
  }
}

export function createLegacyTextResultError(code, message, details = {}) {
  return new LegacyTextResultError(code, message, details);
}