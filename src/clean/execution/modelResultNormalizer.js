import { MODEL_MANIFEST_TYPES } from '../models/modelManifestSchema.js';
import { MODEL_EXECUTION_ERROR_CODES, createModelExecutionError } from './modelExecutionErrors.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertSupportedManifestType(manifest) {
  const type = normalizeText(manifest?.type);
  if (!MODEL_MANIFEST_TYPES.includes(type)) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_UNSUPPORTED_TYPE,
      'Model result type is unsupported.',
      { type },
    );
  }
  return type;
}

function assertProviderResult(providerResult) {
  if (providerResult === null || providerResult === undefined) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_BAD_RESULT,
      'Model provider result is empty.',
    );
  }
  if (typeof providerResult === 'string' && providerResult.length === 0) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_BAD_RESULT,
      'Model provider result is empty.',
    );
  }
  if (isObject(providerResult) && Object.keys(providerResult).length === 0) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_BAD_RESULT,
      'Model provider result is empty.',
    );
  }
}

function firstOpenAIChatText(providerResult) {
  const content = providerResult?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function normalizeTextResult(providerResult) {
  if (typeof providerResult === 'string') {
    return providerResult;
  }
  if (!isObject(providerResult)) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_NORMALIZE_FAILED,
      'Text model result cannot be normalized.',
    );
  }

  const chatText = firstOpenAIChatText(providerResult);
  if (chatText) return chatText;
  if (typeof providerResult.text === 'string') return providerResult.text;
  if (typeof providerResult.content === 'string') return providerResult.content;

  throw createModelExecutionError(
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_NORMALIZE_FAILED,
    'Text model result cannot be normalized.',
  );
}

function normalizeArrayResult(providerResult, field) {
  if (isObject(providerResult) && Array.isArray(providerResult[field])) {
    return providerResult[field];
  }
  if (Array.isArray(providerResult)) {
    return providerResult;
  }
  return [];
}

export function normalizeModelResult({ manifest, providerResult } = {}) {
  const type = assertSupportedManifestType(manifest);
  assertProviderResult(providerResult);

  if (type === 'text') {
    return {
      type: 'text',
      text: normalizeTextResult(providerResult),
      raw: providerResult,
    };
  }
  if (type === 'image') {
    return {
      type: 'image',
      images: normalizeArrayResult(providerResult, 'images'),
      raw: providerResult,
    };
  }
  if (type === 'video') {
    return {
      type: 'video',
      videos: normalizeArrayResult(providerResult, 'videos'),
      raw: providerResult,
    };
  }
  if (type === 'audio') {
    return {
      type: 'audio',
      audios: normalizeArrayResult(providerResult, 'audios'),
      raw: providerResult,
    };
  }
  if (type === 'multimodal') {
    return {
      type: 'multimodal',
      items: normalizeArrayResult(providerResult, 'items'),
      raw: providerResult,
    };
  }

  throw createModelExecutionError(
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_UNSUPPORTED_TYPE,
    'Model result type is unsupported.',
    { type },
  );
}