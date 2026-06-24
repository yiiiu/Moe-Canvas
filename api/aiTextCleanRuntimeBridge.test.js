import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_TEXT_ERROR_CODES,
} from '../src/clean/legacy/legacyTextErrors.js';
import {
  createAiTextCleanRuntimeBridge,
  maybeRunAiTextCleanRuntime,
  shouldUseAiTextCleanRuntime,
} from './aiTextCleanRuntimeBridge.js';

function createFakeExecutor(result = {}) {
  const calls = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return {
        success: true,
        text: 'clean bridge text',
        outputText: 'clean bridge text',
        taskId: request.context?.taskId || 'task-clean-bridge',
        raw: { provider: 'fake-clean-executor' },
        normalizedResult: { text: 'clean bridge text' },
        source: 'clean-runtime',
        ...result,
      };
    },
  };
}

test('shouldUseAiTextCleanRuntime is false when no opt-in flag is present', () => {
  assert.equal(shouldUseAiTextCleanRuntime({ prompt: 'Legacy path' }), false);
});

test('maybeRunAiTextCleanRuntime does not call clean executor without opt-in', async () => {
  const executor = createFakeExecutor();

  const result = await maybeRunAiTextCleanRuntime({ prompt: 'Legacy path' }, { executor });

  assert.equal(result, null);
  assert.equal(executor.calls.length, 0);
});

test('useCleanRuntime=true routes request to clean executor', async () => {
  const executor = createFakeExecutor();

  const result = await maybeRunAiTextCleanRuntime({
    useCleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.equal(executor.calls.length, 1);
  assert.equal(result.success, true);
  assert.equal(result.text, 'clean bridge text');
  assert.equal(result.outputText, 'clean bridge text');
});

test('__useCleanRuntime=true routes request to clean executor', async () => {
  const executor = createFakeExecutor();

  await maybeRunAiTextCleanRuntime({
    __useCleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.equal(executor.calls.length, 1);
});

test('cleanRuntime=true routes request to clean executor', async () => {
  const executor = createFakeExecutor();

  await maybeRunAiTextCleanRuntime({
    cleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.equal(executor.calls.length, 1);
});

test('bridge passes prompt systemPrompt input manifestId providerConfig and context to executor', async () => {
  const executor = createFakeExecutor();
  const bridge = createAiTextCleanRuntimeBridge({ executor });
  const input = { theme: '赛博侦探' };
  const providerConfig = { model: 'fake-model', apiKey: 'fake-key' };
  const context = { taskId: 'task-context' };

  await bridge.executeIfRequested({
    useCleanRuntime: true,
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
    input,
    manifestId: 'ai-comic-script',
    providerConfig,
    context,
  });

  assert.deepEqual(executor.calls[0], {
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
    input,
    manifestId: 'ai-comic-script',
    providerConfig,
    context,
  });
});

test('clean executor success result is returned unchanged', async () => {
  const executor = createFakeExecutor({
    success: true,
    text: 'executor success',
    outputText: 'executor success',
  });

  const result = await maybeRunAiTextCleanRuntime({
    useCleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.equal(result.success, true);
  assert.equal(result.text, 'executor success');
  assert.equal(result.outputText, 'executor success');
  assert.equal(result.source, 'clean-runtime');
});

test('clean executor failure result is returned unchanged', async () => {
  const executor = createFakeExecutor({
    success: false,
    error: 'executor failed',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
  });

  const result = await maybeRunAiTextCleanRuntime({
    useCleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.deepEqual(result, {
    success: false,
    error: 'executor failed',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
    source: 'clean-runtime',
    text: 'clean bridge text',
    outputText: 'clean bridge text',
    taskId: 'task-clean-bridge',
    raw: { provider: 'fake-clean-executor' },
    normalizedResult: { text: 'clean bridge text' },
  });
});

test('executor throw is converted to clean-runtime failure result', async () => {
  const executor = {
    calls: [],
    async execute(request) {
      this.calls.push(request);
      throw new Error('executor exploded');
    },
  };

  const result = await maybeRunAiTextCleanRuntime({
    useCleanRuntime: true,
    prompt: 'Clean path',
  }, { executor });

  assert.deepEqual(result, {
    success: false,
    error: 'AI text clean runtime bridge failed.',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
    source: 'clean-runtime',
  });
  assert.equal(executor.calls.length, 1);
});