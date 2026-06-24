import test from 'node:test';
import assert from 'node:assert/strict';

import { openaiChatManifest } from '../models/manifests/openaiChatManifest.js';
import {
  ModelExecutionError,
  MODEL_EXECUTION_ERROR_CODES,
} from './modelExecutionErrors.js';
import { ModelExecutionService } from './modelExecutionService.js';

function createFakeManifestRegistry(manifest = openaiChatManifest) {
  const calls = [];
  return {
    calls,
    getManifest(manifestId) {
      calls.push({ method: 'getManifest', manifestId });
      if (!manifest) {
        throw new Error('manifest not found');
      }
      return manifest;
    },
  };
}

function createFakeProviderRegistry(adapter) {
  const calls = [];
  return {
    calls,
    createProvider(provider, config) {
      calls.push({ method: 'createProvider', provider, config });
      if (!adapter) {
        throw new Error('provider not found');
      }
      return adapter;
    },
  };
}

function createFakeTextAdapter(providerResult = 'Normalized text') {
  const calls = [];
  return {
    calls,
    async submitChatCompletion(input) {
      calls.push({ method: 'submitChatCompletion', input });
      return providerResult;
    },
  };
}

async function assertModelExecutionError(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ModelExecutionError && error.code === code,
  );
}

test('ModelExecutionService can execute openai-compatible-chat successfully', async () => {
  const providerResult = {
    choices: [
      {
        message: {
          content: 'Hello from service.',
        },
      },
    ],
  };
  const adapter = createFakeTextAdapter(providerResult);
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  const execution = await service.execute({
    manifestId: 'openai-compatible-chat',
    input: {
      prompt: 'Say hello.',
    },
    context: {
      taskId: 'task-service-1',
      providerConfig: {
        apiKey: 'fake-key',
      },
    },
  });

  assert.equal(execution.taskId, 'task-service-1');
  assert.equal(execution.modelId, 'openai-compatible-chat');
  assert.equal(execution.provider, 'openai-compatible');
  assert.equal(execution.type, 'text');
  assert.equal(execution.status, 'succeeded');
  assert.equal(execution.payload.input.prompt, 'Say hello.');
  assert.deepEqual(execution.result, {
    type: 'text',
    text: 'Hello from service.',
    raw: providerResult,
  });
  assert.deepEqual(execution.raw, providerResult);
});

test('ModelExecutionService calls manifestRegistry.getManifest', async () => {
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await service.execute({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Trace manifest.' },
    context: { taskId: 'task-service-2' },
  });

  assert.deepEqual(manifestRegistry.calls, [
    { method: 'getManifest', manifestId: 'openai-compatible-chat' },
  ]);
});

test('ModelExecutionService calls providerRegistry.createProvider', async () => {
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await service.execute({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Trace provider.' },
    context: {
      taskId: 'task-service-3',
      providerConfig: { baseURL: 'https://example.invalid' },
    },
  });

  assert.deepEqual(providerRegistry.calls, [
    {
      method: 'createProvider',
      provider: 'openai-compatible',
      config: { baseURL: 'https://example.invalid' },
    },
  ]);
});

test('ModelExecutionService calls text adapter submitChatCompletion', async () => {
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await service.execute({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Trace adapter.', temperature: 0.1 },
    context: { taskId: 'task-service-4' },
  });

  assert.deepEqual(adapter.calls, [
    {
      method: 'submitChatCompletion',
      input: {
        temperature: 0.1,
        maxTokens: 2048,
        prompt: 'Trace adapter.',
      },
    },
  ]);
});

test('ModelExecutionService returns normalized text result', async () => {
  const adapter = createFakeTextAdapter('Plain text result.');
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  const execution = await service.execute({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Normalize.' },
    context: { taskId: 'task-service-5' },
  });

  assert.deepEqual(execution.result, {
    type: 'text',
    text: 'Plain text result.',
    raw: 'Plain text result.',
  });
});

test('ModelExecutionService passes context taskId to final result', async () => {
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  const execution = await service.execute({
    manifestId: 'openai-compatible-chat',
    input: { prompt: 'Keep task id.' },
    context: { taskId: 'task-from-context' },
  });

  assert.equal(execution.taskId, 'task-from-context');
  assert.equal(execution.payload.taskId, 'task-from-context');
});

test('ModelExecutionService maps missing manifest to MODEL_EXECUTION_MANIFEST_NOT_FOUND', async () => {
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry(null);
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await assertModelExecutionError(
    () => service.execute({
      manifestId: 'missing-manifest',
      input: { prompt: 'Missing manifest.' },
      context: {},
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_MANIFEST_NOT_FOUND,
  );
});

test('ModelExecutionService maps missing provider to MODEL_EXECUTION_PROVIDER_NOT_FOUND', async () => {
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(null);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await assertModelExecutionError(
    () => service.execute({
      manifestId: 'openai-compatible-chat',
      input: { prompt: 'Missing provider.' },
      context: {},
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_PROVIDER_NOT_FOUND,
  );
});

test('ModelExecutionService rejects unsupported manifest type', async () => {
  const imageManifest = {
    ...openaiChatManifest,
    id: 'mock-image-model',
    type: 'image',
  };
  const adapter = createFakeTextAdapter();
  const manifestRegistry = createFakeManifestRegistry(imageManifest);
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await assertModelExecutionError(
    () => service.execute({
      manifestId: 'mock-image-model',
      input: { prompt: 'Unsupported.' },
      context: {},
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_UNSUPPORTED_TYPE,
  );
});

test('ModelExecutionService wraps adapter failure as MODEL_EXECUTION_FAILED', async () => {
  const adapter = {
    async submitChatCompletion() {
      throw new Error('adapter failed');
    },
  };
  const manifestRegistry = createFakeManifestRegistry();
  const providerRegistry = createFakeProviderRegistry(adapter);
  const service = new ModelExecutionService({ manifestRegistry, providerRegistry });

  await assertModelExecutionError(
    () => service.execute({
      manifestId: 'openai-compatible-chat',
      input: { prompt: 'Adapter failure.' },
      context: {},
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_EXECUTION_FAILED,
  );
});