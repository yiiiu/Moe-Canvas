export const MODEL_EXECUTION_ERROR_CODES = Object.freeze({
  MODEL_TASK_INVALID_MANIFEST: 'MODEL_TASK_INVALID_MANIFEST',
  MODEL_TASK_INPUT_MISSING: 'MODEL_TASK_INPUT_MISSING',
  MODEL_TASK_UNSUPPORTED_TYPE: 'MODEL_TASK_UNSUPPORTED_TYPE',
  MODEL_TASK_NORMALIZE_FAILED: 'MODEL_TASK_NORMALIZE_FAILED',
  MODEL_TASK_BAD_RESULT: 'MODEL_TASK_BAD_RESULT',
});

export class ModelExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ModelExecutionError';
    this.code = code;
    this.details = details;
  }
}

export function createModelExecutionError(code, message, details = {}) {
  return new ModelExecutionError(code, message, details);
}