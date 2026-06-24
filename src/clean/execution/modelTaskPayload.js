import { MODEL_MANIFEST_TYPES } from '../models/modelManifestSchema.js';
import { MODEL_EXECUTION_ERROR_CODES, createModelExecutionError } from './modelExecutionErrors.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertValidManifest(manifest) {
  if (!isObject(manifest)) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_INVALID_MANIFEST,
      'Model task manifest is required.',
    );
  }

  const id = normalizeText(manifest.id);
  const provider = normalizeText(manifest.provider);
  const type = normalizeText(manifest.type);

  if (!id || !provider || !type) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_INVALID_MANIFEST,
      'Model task manifest must include id, provider and type.',
      { id, provider, type },
    );
  }

  if (!MODEL_MANIFEST_TYPES.includes(type)) {
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_UNSUPPORTED_TYPE,
      'Model task manifest type is unsupported.',
      { id, type },
    );
  }
}

function isMissingInputValue(value) {
  return value === undefined || value === null || value === '';
}

function assertRequiredInputs(inputSchema, input) {
  if (!isObject(inputSchema)) return;

  for (const [field, schema] of Object.entries(inputSchema)) {
    if (!schema || schema.required !== true) continue;
    if (isMissingInputValue(input[field])) {
      throw createModelExecutionError(
        MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_INPUT_MISSING,
        'Model task required input is missing.',
        { field },
      );
    }
  }
}

function createTaskId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `model-task:${timestamp}:${random}`;
}

export function buildModelTaskPayload({ manifest, input = {}, context = {} } = {}) {
  assertValidManifest(manifest);

  const defaults = isObject(manifest.defaults) ? manifest.defaults : {};
  const taskInput = {
    ...defaults,
    ...(isObject(input) ? input : {}),
  };
  assertRequiredInputs(manifest.inputSchema, taskInput);

  const taskContext = isObject(context) ? { ...context } : {};
  const taskId = normalizeText(taskContext.taskId) || createTaskId();

  return {
    taskId,
    modelId: normalizeText(manifest.id),
    provider: normalizeText(manifest.provider),
    type: normalizeText(manifest.type),
    input: taskInput,
    context: taskContext,
    createdAt: new Date().toISOString(),
  };
}