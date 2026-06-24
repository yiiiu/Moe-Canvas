import test from 'node:test';
import assert from 'node:assert/strict';

import { BaseProviderAdapter } from '../providers/baseProviderAdapter.js';
import { ModelManifestRegistry } from '../models/modelManifestRegistry.js';
import { ProviderRegistry } from '../providers/providerRegistry.js';
import { createModelExecutionRuntime } from './modelExecutionRuntime.js';

const customTextManifest = Object.freeze({
  id: 'custom-text-model',
  name: 'Custom Text Model',
  provider: 'custom-provider',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
  }),
  inputSchema: Object.freeze({
    prompt: Object.freeze({
      type: 'string',
      required: true,
    }),
  }),
  uiSchema: Object.freeze({
    prompt: Object.freeze({
      widget: 'textarea',
      label: 'Prompt',
    }),
  }),
  defaults: Object.freeze({}),
});

class CustomProviderAdapter extends BaseProviderAdapter {
  async submitChatCompletion(input) {
    return {
      choices: [
        {
          message: {
            content: `custom:${input.prompt}`,
          },
        },
      ],
    };
  }
}

function createFakeExecutionService(result = { status: 'succeeded' }) {
  const calls = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return result;
    },
  };
}

test('createModelExecutionRuntime can create default runtime', () => {
  const runtime = createModelExecutionRuntime();

  assert.equal(typeof runtime.executeModel, 'function');
  assert.equal(typeof runtime.listModels, 'function');
  assert.equal(typeof runtime.listModelsByProvider, 'function');
  assert.equal(typeof runtime.listModelsByType, 'function');
  assert.equal(typeof runtime.hasModel, 'function');
});

test('default runtime includes openai-compatible-chat', () => {
  const runtime = createModelExecutionRuntime();

  assert.equal(runtime.hasModel('openai-compatible-chat'), true);
});

test('listModels returns default manifest', () => {
  const runtime = createModelExecutionRuntime();

  assert.deepEqual(
    runtime.listModels().map((model) => model.id),
    ['openai-compatible-chat'],
  );
});

test('listModelsByProvider can filter openai-compatible', () => {
  const runtime = createModelExecutionRuntime();

  assert.deepEqual(
    runtime.listModelsByProvider('openai-compatible').map((model) => model.id),
    ['openai-compatible-chat'],
  );
});

test('listModelsByType can filter text', () => {
  const runtime = createModelExecutionRuntime();

  assert.deepEqual(
    runtime.listModelsByType('text').map((model) => model.id),
    ['openai-compatible-chat'],
  );
});

test('hasModel can check model existence', () => {
  const runtime = createModelExecutionRuntime();

  assert.equal(runtime.hasModel('openai-compatible-chat'), true);
  assert.equal(runtime.hasModel('missing-model'), false);
});

test('executeModel calls executionService.execute', async () => {
  const executionService = createFakeExecutionService({ taskId: 'task-runtime-1' });
  const runtime = createModelExecutionRuntime({ executionService });

  const result = await runtime.executeModel({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Hello runtime.' },
    context: { taskId: 'task-runtime-1' },
  });

  assert.deepEqual(result, { taskId: 'task-runtime-1' });
  assert.deepEqual(executionService.calls, [
    {
      manifestId: 'openai-compatible-chat',
      input: { prompt: 'Hello runtime.' },
      context: { taskId: 'task-runtime-1', providerConfig: undefined },
    },
  ]);
});

test('providerConfigResolver result is written to context.providerConfig', async () => {
  const executionService = createFakeExecutionService();
  const runtime = createModelExecutionRuntime({
    executionService,
    providerConfigResolver(manifestId, context) {
      return {
        apiKey: `fake-key-for-${manifestId}`,
        taskId: context.taskId,
      };
    },
  });

  await runtime.executeModel({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Resolve config.' },
    context: {
      taskId: 'task-runtime-2',
      providerConfig: { apiKey: 'old-key' },
    },
  });

  assert.deepEqual(executionService.calls[0].context, {
    taskId: 'task-runtime-2',
    providerConfig: {
      apiKey: 'fake-key-for-openai-compatible-chat',
      taskId: 'task-runtime-2',
    },
  });
});

test('custom executionService takes precedence for execution', async () => {
  const executionService = createFakeExecutionService({ status: 'custom-executed' });
  const runtime = createModelExecutionRuntime({ executionService });

  const result = await runtime.executeModel({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Use fake service.' },
  });

  assert.deepEqual(result, { status: 'custom-executed' });
  assert.equal(executionService.calls.length, 1);
});

test('custom manifestRegistry takes precedence for listing models', () => {
  const manifestRegistry = new ModelManifestRegistry([customTextManifest]);
  const runtime = createModelExecutionRuntime({
    manifestRegistry,
    executionService: createFakeExecutionService(),
  });

  assert.deepEqual(
    runtime.listModels().map((model) => model.id),
    ['custom-text-model'],
  );
  assert.equal(runtime.hasModel('custom-text-model'), true);
  assert.equal(runtime.hasModel('openai-compatible-chat'), false);
});

test('custom providerRegistry takes precedence when default executionService is created', async () => {
  const manifestRegistry = new ModelManifestRegistry([customTextManifest]);
  const providerRegistry = new ProviderRegistry([
    {
      id: 'custom-provider',
      adapterClass: CustomProviderAdapter,
    },
  ]);
  const runtime = createModelExecutionRuntime({ manifestRegistry, providerRegistry });

  const result = await runtime.executeModel({
    manifestId: 'custom-text-model',
    input: { prompt: 'Use custom provider.' },
    context: { taskId: 'task-runtime-3' },
  });

  assert.equal(result.modelId, 'custom-text-model');
  assert.equal(result.provider, 'custom-provider');
  assert.equal(result.result.text, 'custom:Use custom provider.');
});