import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEBUG_ERROR_CODES,
  DebugRunnerError,
} from './debugErrors.js';
import {
  createCleanTextDebugRunner,
  runCleanTextDebug,
} from './cleanTextDebugRunner.js';

function createFakeRuntime(result = {}) {
  const calls = [];
  return {
    calls,
    async executeModel(request) {
      calls.push(request);
      return {
        taskId: request.context?.taskId || 'task-fake-runtime',
        status: 'succeeded',
        result: { text: 'fake text' },
        raw: { provider: 'fake' },
        ...result,
      };
    },
  };
}

test('runText uses openai-compatible-chat as default manifestId', async () => {
  const runtime = createFakeRuntime();
  const runner = createCleanTextDebugRunner({ runtime });

  const output = await runner.runText({ prompt: 'Hello clean debug.' });

  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].manifestId, 'openai-compatible-chat');
  assert.equal(output.manifestId, 'openai-compatible-chat');
});

test('runText supports custom manifestId', async () => {
  const runtime = createFakeRuntime();
  const runner = createCleanTextDebugRunner({ runtime });

  const output = await runner.runText({
    manifestId: 'ai-comic-script',
    prompt: '写一个反转短剧。',
  });

  assert.equal(runtime.calls[0].manifestId, 'ai-comic-script');
  assert.equal(output.manifestId, 'ai-comic-script');
});

test('runText builds input from prompt and systemPrompt', async () => {
  const runtime = createFakeRuntime();
  const runner = createCleanTextDebugRunner({ runtime });

  await runner.runText({
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
  });

  assert.deepEqual(runtime.calls[0].input, {
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
  });
});

test('runText prefers complete input over prompt fields', async () => {
  const runtime = createFakeRuntime();
  const runner = createCleanTextDebugRunner({ runtime });
  const input = {
    theme: '赛博猫咪侦探',
    genre: '悬疑喜剧',
  };

  await runner.runText({
    prompt: 'ignored prompt',
    systemPrompt: 'ignored system prompt',
    input,
  });

  assert.equal(runtime.calls[0].input, input);
});

test('runText writes providerConfig into context', async () => {
  const runtime = createFakeRuntime();
  const providerConfig = { apiKey: 'fake-key', model: 'fake-model' };
  const runner = createCleanTextDebugRunner({ runtime });

  await runner.runText({
    prompt: 'Use config',
    providerConfig,
    context: { taskId: 'task-config' },
  });

  assert.deepEqual(runtime.calls[0].context, {
    taskId: 'task-config',
    providerConfig,
  });
});

test('runText can resolve providerConfig when providerConfigResolver is provided', async () => {
  const runtime = createFakeRuntime();
  const runner = createCleanTextDebugRunner({
    runtime,
    providerConfigResolver(manifestId, context) {
      return {
        model: `${manifestId}:${context.taskId}`,
      };
    },
  });

  await runner.runText({
    manifestId: 'ai-comic-script',
    prompt: 'Resolve config',
    context: { taskId: 'task-resolver' },
  });

  assert.deepEqual(runtime.calls[0].context.providerConfig, {
    model: 'ai-comic-script:task-resolver',
  });
});

test('runText passes context.taskId through and maps execution text', async () => {
  const runtime = createFakeRuntime({
    taskId: 'task-output',
    status: 'succeeded',
    result: { text: 'mapped text', usage: { totalTokens: 12 } },
    raw: { id: 'raw-result' },
  });
  const runner = createCleanTextDebugRunner({ runtime });

  const output = await runner.runText({
    prompt: 'Map result',
    context: { taskId: 'task-output' },
  });

  assert.equal(runtime.calls.length, 1);
  assert.equal(runtime.calls[0].context.taskId, 'task-output');
  assert.deepEqual(output, {
    manifestId: 'openai-compatible-chat',
    taskId: 'task-output',
    status: 'succeeded',
    text: 'mapped text',
    result: { text: 'mapped text', usage: { totalTokens: 12 } },
    raw: { id: 'raw-result' },
  });
});

test('runText maps runtime failures to DEBUG_TEXT_RUN_FAILED', async () => {
  const runtime = {
    async executeModel() {
      throw new Error('runtime exploded');
    },
  };
  const runner = createCleanTextDebugRunner({ runtime });

  await assert.rejects(
    () => runner.runText({ prompt: 'fail' }),
    (error) => error instanceof DebugRunnerError
      && error.code === DEBUG_ERROR_CODES.DEBUG_TEXT_RUN_FAILED
      && error.details.cause instanceof Error,
  );
});

test('runText rejects empty normalized text result', async () => {
  const runtime = createFakeRuntime({ result: { text: '' } });
  const runner = createCleanTextDebugRunner({ runtime });

  await assert.rejects(
    () => runner.runText({ prompt: 'empty' }),
    (error) => error instanceof DebugRunnerError
      && error.code === DEBUG_ERROR_CODES.DEBUG_TEXT_EMPTY_RESULT,
  );
});

test('createCleanTextDebugRunner can create a default runtime without executing remote requests', () => {
  const runner = createCleanTextDebugRunner();

  assert.equal(typeof runner.runText, 'function');
});

test('runCleanTextDebug uses a supplied fake runtime', async () => {
  const runtime = createFakeRuntime({ result: { text: 'top-level debug' } });

  const output = await runCleanTextDebug({
    runtime,
    prompt: 'Top-level call',
  });

  assert.equal(runtime.calls.length, 1);
  assert.equal(output.text, 'top-level debug');
});
