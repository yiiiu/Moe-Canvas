import { createModelExecutionRuntime } from '../execution/modelExecutionRuntime.js';
import {
  DEBUG_ERROR_CODES,
  DebugRunnerError,
  createDebugRunnerError,
} from './debugErrors.js';

const DEFAULT_TEXT_MANIFEST_ID = 'openai-compatible-chat';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveManifestId(manifestId, defaultManifestId) {
  return normalizeText(manifestId) || defaultManifestId;
}

function buildTextInput({ input, prompt, systemPrompt } = {}) {
  if (isObject(input)) {
    return input;
  }

  const result = {};
  const promptText = normalizeText(prompt);
  const systemPromptText = normalizeText(systemPrompt);
  if (promptText) {
    result.prompt = promptText;
  }
  if (systemPromptText) {
    result.systemPrompt = systemPromptText;
  }
  return result;
}

function resolveProviderConfig({ providerConfig, providerConfigResolver, manifestId, context }) {
  if (isObject(providerConfig)) {
    return providerConfig;
  }
  if (typeof providerConfigResolver === 'function') {
    return providerConfigResolver(manifestId, context);
  }
  return undefined;
}

function assertRuntime(runtime) {
  if (!runtime || typeof runtime.executeModel !== 'function') {
    throw createDebugRunnerError(
      DEBUG_ERROR_CODES.DEBUG_RUNTIME_MISSING,
      'Clean text debug runner requires a runtime with executeModel.',
    );
  }
}

function mapExecutionResult({ manifestId, executionResult }) {
  const result = isObject(executionResult?.result) ? executionResult.result : null;
  const text = normalizeText(result?.text);
  if (!text) {
    throw createDebugRunnerError(
      DEBUG_ERROR_CODES.DEBUG_TEXT_EMPTY_RESULT,
      'Clean text debug runner received an empty text result.',
      { manifestId, executionResult },
    );
  }
  return {
    manifestId,
    taskId: executionResult?.taskId,
    status: executionResult?.status,
    text,
    result,
    raw: executionResult?.raw,
  };
}

export function createCleanTextDebugRunner(options = {}) {
  const {
    runtime = createModelExecutionRuntime(options),
    providerConfigResolver,
    defaultManifestId = DEFAULT_TEXT_MANIFEST_ID,
  } = options;

  return {
    async runText({ manifestId, prompt, systemPrompt, input, providerConfig, context = {} } = {}) {
      assertRuntime(runtime);
      const resolvedManifestId = resolveManifestId(manifestId, defaultManifestId);
      const baseContext = isObject(context) ? context : {};
      const resolvedProviderConfig = resolveProviderConfig({
        providerConfig,
        providerConfigResolver,
        manifestId: resolvedManifestId,
        context: baseContext,
      });

      try {
        const executionResult = await runtime.executeModel({
          manifestId: resolvedManifestId,
          input: buildTextInput({ input, prompt, systemPrompt }),
          context: {
            ...baseContext,
            providerConfig: resolvedProviderConfig,
          },
        });
        return mapExecutionResult({
          manifestId: resolvedManifestId,
          executionResult,
        });
      } catch (error) {
        if (error instanceof DebugRunnerError) {
          throw error;
        }
        throw createDebugRunnerError(
          DEBUG_ERROR_CODES.DEBUG_TEXT_RUN_FAILED,
          'Clean text debug runner failed to execute text model.',
          { manifestId: resolvedManifestId, cause: error },
        );
      }
    },
  };
}

export async function runCleanTextDebug(input = {}) {
  const runner = createCleanTextDebugRunner(input);
  return runner.runText(input);
}
