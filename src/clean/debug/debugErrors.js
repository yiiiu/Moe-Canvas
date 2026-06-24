export const DEBUG_ERROR_CODES = Object.freeze({
  DEBUG_TEXT_RUN_FAILED: 'DEBUG_TEXT_RUN_FAILED',
  DEBUG_RUNTIME_MISSING: 'DEBUG_RUNTIME_MISSING',
  DEBUG_TEXT_EMPTY_RESULT: 'DEBUG_TEXT_EMPTY_RESULT',
});

export class DebugRunnerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DebugRunnerError';
    this.code = code;
    this.details = details;
  }
}

export function createDebugRunnerError(code, message, details = {}) {
  return new DebugRunnerError(code, message, details);
}
