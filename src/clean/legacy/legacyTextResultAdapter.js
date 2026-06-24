import {
  LEGACY_TEXT_ERROR_CODES,
  LegacyTextResultError,
  createLegacyTextResultError,
} from './legacyTextErrors.js';

const CLEAN_RUNTIME_SOURCE = 'clean-runtime';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createBadResultError(message, details = {}) {
  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_RESULT,
    message,
    details,
  );
}

function createEmptyResultError(details = {}) {
  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_EMPTY_RESULT,
    'Clean text result is empty.',
    details,
  );
}

export function toLegacyTextResult(cleanResult) {
  if (!isObject(cleanResult)) {
    throw createBadResultError('Clean text result must be an object.', { cleanResult });
  }

  const text = normalizeText(cleanResult.text);
  if (!text) {
    throw createEmptyResultError({ cleanResult });
  }

  return {
    success: true,
    text,
    outputText: text,
    taskId: cleanResult.taskId,
    raw: cleanResult.raw,
    normalizedResult: cleanResult.result,
    source: CLEAN_RUNTIME_SOURCE,
  };
}

export function assertLegacyTextResult(result) {
  if (!isObject(result)) {
    throw createBadResultError('Legacy text result must be an object.', { result });
  }

  if (result.success === true) {
    const text = normalizeText(result.text);
    const outputText = normalizeText(result.outputText);
    if (!text || !outputText) {
      throw createBadResultError(
        'Legacy text success result requires text and outputText.',
        { result },
      );
    }
    if (result.source !== CLEAN_RUNTIME_SOURCE) {
      throw createBadResultError('Legacy text result source must be clean-runtime.', { result });
    }
    return result;
  }

  if (result.success === false) {
    if (!normalizeText(result.error) || !normalizeText(result.code)) {
      throw createBadResultError('Legacy text error result requires error and code.', { result });
    }
    if (result.source !== CLEAN_RUNTIME_SOURCE) {
      throw createBadResultError('Legacy text result source must be clean-runtime.', { result });
    }
    return result;
  }

  if (result instanceof LegacyTextResultError) {
    return assertLegacyTextResult(result.toLegacyResult());
  }

  throw createBadResultError('Legacy text result success must be boolean.', { result });
}