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

  async executeRoute(adapter, payload, methodName) {
    if (typeof adapter[methodName] !== 'function') {
      throw createModelExecutionError(
        MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_FAILED,
        'Model adapter route is not implemented.',
        { type: payload.type, methodName },
      );
    }
    return adapter[methodName](payload.input);
  }

  async executeAdapter(adapter, payload) {
    const routeByType = {
      text: 'submitChatCompletion',
      image: 'submitImageGeneration',
      video: 'submitVideoGeneration',
      audio: 'submitAudioGeneration',
      multimodal: 'submitMultimodal',
    };
    const methodName = routeByType[payload.type];
    if (methodName) {
      return this.executeRoute(adapter, payload, methodName);
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
    let payload;
    try {
      payload = buildModelTaskPayload({ manifest, input, context: taskContext });
    } catch (error) {
      if (error instanceof ModelExecutionError && error.code === MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_UNSUPPORTED_TYPE) {
        throw wrapExecutionError(
          error,
          MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_UNSUPPORTED_TYPE,
          'Model execution type is unsupported.',
          { manifestId, type: manifest.type },
        );
      }
      throw error;
    }
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