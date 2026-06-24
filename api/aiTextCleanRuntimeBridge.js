import {
  createCleanTextDebugRunner,
} from '../src/clean/debug/cleanTextDebugRunner.js';
import {
  LEGACY_TEXT_ERROR_CODES,
  createLegacyTextResultError,
} from '../src/clean/legacy/legacyTextErrors.js';
import {
  assertLegacyTextResult,
} from '../src/clean/legacy/legacyTextResultAdapter.js';
import {
  createLegacyTextCleanExecutor,
} from '../src/clean/legacy/legacyTextCleanExecutor.js';

const CLEAN_RUNTIME_SOURCE = 'clean-runtime';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickCleanRequest(input = {}) {
  return {
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    input: input.input,
    manifestId: input.manifestId,
    providerConfig: input.providerConfig,
    context: input.context,
  };
}

function createCleanRuntimeBridgeFailure() {
  return createLegacyTextResultError(
    LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
    'AI text clean runtime bridge failed.',
  ).toLegacyResult();
}

export function shouldUseAiTextCleanRuntime(input = {}) {
  if (!isObject(input)) {
    return false;
  }
  return input.useCleanRuntime === true
    || input.__useCleanRuntime === true
    || input.cleanRuntime === true;
}

export function createAiTextCleanRuntimeBridge(options = {}) {
  const providedExecutor = options.executor;

  return {
    async executeIfRequested(input = {}) {
      if (!shouldUseAiTextCleanRuntime(input)) {
        return null;
      }

      const executor = providedExecutor || createLegacyTextCleanExecutor({
        ...options,
        runner: options.runner || createCleanTextDebugRunner(options),
      });

      try {
        const result = await executor.execute(pickCleanRequest(input));
        return assertLegacyTextResult(result);
      } catch {
        return {
          ...createCleanRuntimeBridgeFailure(),
          source: CLEAN_RUNTIME_SOURCE,
        };
      }
    },
  };
}

export async function maybeRunAiTextCleanRuntime(input = {}, options = {}) {
  const bridge = createAiTextCleanRuntimeBridge(options);
  return bridge.executeIfRequested(input);
}