import {
  LEGACY_TEXT_ERROR_CODES,
  LegacyTextResultError,
  createLegacyTextResultError,
} from './legacyTextErrors.js';
import {
  assertLegacyTextResult,
  toLegacyTextResult,
} from './legacyTextResultAdapter.js';

const CLEAN_RUNTIME_SOURCE = 'clean-runtime';
const DEFAULT_TEXT_MANIFEST_ID = 'openai-compatible-chat';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toLegacyErrorResult(error) {
  if (error instanceof LegacyTextResultError) {
    return error.toLegacyResult();
  }

  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
    'Legacy text clean execution failed.',
    { cause: error },
  ).toLegacyResult();
}

function createBadRequestResult(message, details = {}) {
  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_REQUEST,
    message,
    details,
  ).toLegacyResult();
}

function createRunnerMissingResult(details = {}) {
  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_RUNNER_MISSING,
    'Legacy text clean executor requires a runner with runText.',
    details,
  ).toLegacyResult();
}

function resolveProviderConfig({ providerConfig, providerConfigResolver, manifestId, context }) {
  if (isObject(providerConfig)) {
    return providerConfig;
  }
  if (typeof providerConfigResolver === 'function') {
    return providerConfigResolver(manifestId, context);
  }
  return providerConfig;
}

function hasPromptOrInput(request) {
  return Boolean(normalizeText(request?.prompt)) || isObject(request?.input);
}

export function createLegacyTextCleanExecutor(options = {}) {
  const {
    runner,
    defaultManifestId = DEFAULT_TEXT_MANIFEST_ID,
    providerConfigResolver,
  } = options;

  return {
    async execute(request = {}) {
      if (!isObject(request)) {
        return createBadRequestResult('Legacy text clean request must be an object.', { request });
      }
      if (!hasPromptOrInput(request)) {
        return createBadRequestResult('Legacy text clean request requires prompt or input.', { request });
      }
      if (!runner || typeof runner.runText !== 'function') {
        return createRunnerMissingResult();
      }

      const context = isObject(request.context) ? request.context : {};
      const manifestId = normalizeText(request.manifestId) || defaultManifestId;
      const providerConfig = resolveProviderConfig({
        providerConfig: request.providerConfig,
        providerConfigResolver,
        manifestId,
        context,
      });

      try {
        const cleanResult = await runner.runText({
          manifestId,
          prompt: request.prompt,
          systemPrompt: request.systemPrompt,
          input: request.input,
          providerConfig,
          context,
        });
        return assertLegacyTextResult(toLegacyTextResult(cleanResult));
      } catch (error) {
        const legacyError = toLegacyErrorResult(error);
        return assertLegacyTextResult({
          ...legacyError,
          source: CLEAN_RUNTIME_SOURCE,
        });
      }
    },
  };
}

export async function runLegacyTextCleanRequest(request = {}, options = {}) {
  const executor = createLegacyTextCleanExecutor(options);
  return executor.execute(request);
}