import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_TEXT_ERROR_CODES,
} from './legacyTextErrors.js';
import {
  assertLegacyTextResult,
} from './legacyTextResultAdapter.js';
import {
  createLegacyTextCleanExecutor,
  runLegacyTextCleanRequest,
} from './legacyTextCleanExecutor.js';

function createFakeRunner(result = {}) {
  const calls = [];
  return {
    calls,
    async runText(request) {
      calls.push(request);
      return {
        manifestId: request.manifestId,
        taskId: request.context?.taskId || 'task-clean-executor',
        status: 'succeeded',
        text: 'clean executor text',
        result: { text: 'clean executor text' },
        raw: { provider: 'fake-runner' },
        ...result,
      };
    },
  };
}

test('execute can use a fake runner and return a legacy text result', async () => {
  const runner = createFakeRunner({
    taskId: 'task-success',
    text: 'legacy mapped text',
    result: { text: 'legacy mapped text', usage: { totalTokens: 8 } },
    raw: { id: 'raw-success' },
  });
  const executor = createLegacyTextCleanExecutor({ runner });

  const result = await executor.execute({ prompt: 'Write text' });

  assert.deepEqual(result, {
    success: true,
    text: 'legacy mapped text',
    outputText: 'legacy mapped text',
    taskId: 'task-success',
    raw: { id: 'raw-success' },
    normalizedResult: { text: 'legacy mapped text', usage: { totalTokens: 8 } },
    source: 'clean-runtime',
  });
});

test('execute passes prompt and systemPrompt to runner', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({
    runner,
    defaultManifestId: 'openai-compatible-chat',
  });

  await executor.execute({
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
  });

  assert.equal(runner.calls[0].prompt, 'User prompt');
  assert.equal(runner.calls[0].systemPrompt, 'System prompt');
  assert.equal(runner.calls[0].manifestId, 'openai-compatible-chat');
});

test('execute passes input through when input exists', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({ runner });
  const input = { theme: '赛博侦探', genre: '短剧' };

  await executor.execute({
    prompt: 'ignored by executor validation because input exists',
    input,
  });

  assert.equal(runner.calls[0].input, input);
});

test('execute lets request manifestId override defaultManifestId', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({
    runner,
    defaultManifestId: 'openai-compatible-chat',
  });

  await executor.execute({
    manifestId: 'ai-comic-script',
    prompt: 'Write a script',
  });

  assert.equal(runner.calls[0].manifestId, 'ai-comic-script');
});

test('execute passes providerConfig to runner', async () => {
  const runner = createFakeRunner();
  const providerConfig = { model: 'fake-model', apiKey: 'fake-key' };
  const executor = createLegacyTextCleanExecutor({ runner });

  await executor.execute({
    prompt: 'Use config',
    providerConfig,
  });

  assert.equal(runner.calls[0].providerConfig, providerConfig);
});

test('execute passes context.taskId through to runner', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({ runner });

  const result = await executor.execute({
    prompt: 'Keep task id',
    context: { taskId: 'task-context' },
  });

  assert.equal(runner.calls[0].context.taskId, 'task-context');
  assert.equal(result.taskId, 'task-context');
});

test('execute calls runner.runText once', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({ runner });

  await executor.execute({ prompt: 'Call once' });

  assert.equal(runner.calls.length, 1);
});

test('execute returns LEGACY_TEXT_CLEAN_EXECUTION_FAILED when runner throws', async () => {
  const runner = {
    async runText() {
      throw new Error('runner exploded');
    },
  };
  const executor = createLegacyTextCleanExecutor({ runner });

  const result = await executor.execute({ prompt: 'Fail safely' });

  assert.deepEqual(result, {
    success: false,
    error: 'Legacy text clean execution failed.',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_CLEAN_EXECUTION_FAILED,
    source: 'clean-runtime',
  });
});

test('execute returns LEGACY_TEXT_RUNNER_MISSING when runner is missing', async () => {
  const executor = createLegacyTextCleanExecutor();

  const result = await executor.execute({ prompt: 'No runner' });

  assert.deepEqual(result, {
    success: false,
    error: 'Legacy text clean executor requires a runner with runText.',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_RUNNER_MISSING,
    source: 'clean-runtime',
  });
});

test('execute returns LEGACY_TEXT_BAD_REQUEST when prompt and input are missing', async () => {
  const runner = createFakeRunner();
  const executor = createLegacyTextCleanExecutor({ runner });

  const result = await executor.execute({ systemPrompt: 'Only system prompt' });

  assert.equal(runner.calls.length, 0);
  assert.deepEqual(result, {
    success: false,
    error: 'Legacy text clean request requires prompt or input.',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_REQUEST,
    source: 'clean-runtime',
  });
});

test('runLegacyTextCleanRequest uses supplied runner and returns an asserted legacy result', async () => {
  const runner = createFakeRunner({ text: 'top-level result' });

  const result = await runLegacyTextCleanRequest({ prompt: 'Top level' }, { runner });

  assert.equal(runner.calls.length, 1);
  assert.equal(assertLegacyTextResult(result), result);
  assert.equal(result.text, 'top-level result');
});