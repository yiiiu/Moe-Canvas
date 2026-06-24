import { buildModelTaskPayload } from './modelTaskPayload.js';
import { normalizeModelResult } from './modelResultNormalizer.js';
import { MODEL_EXECUTION_ERROR_CODES, ModelExecutionError, createModelExecutionError } from './modelExecutionErrors.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function wrapExecutionError(error, code, message, details = {}) {
  if (error instanceof ModelExecutionError && error.code === code) {
    return error;
  }
  return createModelExecutionError(code, message, {
    ...details,
    cause: error,
  });
}

export class ModelExecutionService {
  constructor({ manifestRegistry, providerRegistry } = {}) {
    this.manifestRegistry = manifestRegistry;
    this.providerRegistry = providerRegistry;
  }

  getManifest(manifestId) {
    try {
      return this.manifestRegistry.getManifest(manifestId);
    } catch (error) {
      throw wrapExecutionError(
        error,
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_MANIFEST_NOT_FOUND,
        'Model execution manifest is not found.',
        { manifestId },
      );
    }
  }

  createProvider(manifest, context) {
    try {
      return this.providerRegistry.createProvider(manifest.provider, context.providerConfig || {});
    } catch (error) {
      throw wrapExecutionError(
        error,
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_PROVIDER_NOT_FOUND,
        'Model execution provider is not found.',
        { provider: manifest.provider },
      );
    }
  }

  async executeText(adapter, payload) {
    if (typeof adapter.submitChatCompletion !== 'function') {
      throw createModelExecutionError(
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_UNSUPPORTED_TYPE,
        'Text model execution requires submitChatCompletion adapter method.',
        { type: payload.type },
      );
    }
    return adapter.submitChatCompletion(payload.input);
  }

  async executeAdapter(adapter, payload) {
    if (payload.type === 'text') {
      return this.executeText(adapter, payload);
    }
    throw createModelExecutionError(
      MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_UNSUPPORTED_TYPE,
      'Model execution type is unsupported.',
      { type: payload.type },
    );
  }

  async execute({ manifestId, input = {}, context = {} } = {}) {
    const taskContext = isObject(context) ? context : {};
    const manifest = this.getManifest(manifestId);
    const payload = buildModelTaskPayload({ manifest, input, context: taskContext });
    const adapter = this.createProvider(manifest, taskContext);

    let providerResult;
    try {
      providerResult = await this.executeAdapter(adapter, payload);
    } catch (error) {
      if (error instanceof ModelExecutionError) {
        throw error;
      }
      throw wrapExecutionError(
        error,
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_FAILED,
        'Model execution failed.',
        { manifestId, provider: payload.provider, type: payload.type },
      );
    }

    try {
      const result = normalizeModelResult({ manifest, providerResult });
      return {
        taskId: payload.taskId,
        modelId: payload.modelId,
        provider: payload.provider,
        type: payload.type,
        status: 'succeeded',
        payload,
        result,
        raw: providerResult,
      };
    } catch (error) {
      if (error instanceof ModelExecutionError) {
        throw error;
      }
      throw wrapExecutionError(
        error,
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_FAILED,
        'Model result normalization failed.',
        { manifestId, provider: payload.provider, type: payload.type },
      );
    }
  }
}