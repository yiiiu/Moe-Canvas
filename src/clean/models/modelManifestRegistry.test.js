import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultModelManifestRegistry,
  ModelManifestError,
  ModelManifestRegistry,
  MODEL_MANIFEST_ERROR_CODES,
} from './modelManifestRegistry.js';
import { openaiChatManifest } from './manifests/openaiChatManifest.js';

const validManifest = Object.freeze({
  id: 'mock-text-model',
  name: 'Mock Text Model',
  provider: 'mock-provider',
  type: 'text',
  capabilities: {
    chatCompletion: true,
    streaming: false,
  },
  inputSchema: {
    prompt: { type: 'string', required: true },
  },
  uiSchema: {
    prompt: { widget: 'textarea' },
  },
  defaults: {
    temperature: 0.7,
  },
});

function cloneManifest(overrides = {}) {
  return {
    ...validManifest,
    capabilities: { ...validManifest.capabilities },
    inputSchema: { ...validManifest.inputSchema },
    uiSchema: { ...validManifest.uiSchema },
    defaults: { ...validManifest.defaults },
    ...overrides,
  };
}

function assertModelManifestError(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ModelManifestError && error.code === code,
  );
}

test('ModelManifestRegistry can register valid manifest', () => {
  const registry = new ModelManifestRegistry();
  const manifest = cloneManifest();

  const returned = registry.registerManifest(manifest);

  assert.equal(returned, registry);
  assert.equal(registry.hasManifest('mock-text-model'), true);
  assert.deepEqual(registry.getManifest('mock-text-model'), manifest);
});

test('ModelManifestRegistry rejects manifest missing id', () => {
  const registry = new ModelManifestRegistry();

  assertModelManifestError(
    () => registry.registerManifest(cloneManifest({ id: '' })),
    MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
  );
});

test('ModelManifestRegistry rejects manifest missing provider', () => {
  const registry = new ModelManifestRegistry();

  assertModelManifestError(
    () => registry.registerManifest(cloneManifest({ provider: '' })),
    MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
  );
});

test('ModelManifestRegistry rejects manifest missing type', () => {
  const registry = new ModelManifestRegistry();

  assertModelManifestError(
    () => registry.registerManifest(cloneManifest({ type: '' })),
    MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
  );
});

test('ModelManifestRegistry rejects unsupported manifest type', () => {
  const registry = new ModelManifestRegistry();

  assertModelManifestError(
    () => registry.registerManifest(cloneManifest({ type: 'embedding' })),
    MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_UNSUPPORTED_TYPE,
  );
});

test('ModelManifestRegistry rejects duplicate manifest id', () => {
  const registry = new ModelManifestRegistry();

  registry.registerManifest(cloneManifest());

  assertModelManifestError(
    () => registry.registerManifest(cloneManifest()),
    MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_ALREADY_REGISTERED,
  );
});

test('ModelManifestRegistry can list manifests by provider', () => {
  const registry = new ModelManifestRegistry();
  const firstManifest = cloneManifest({ id: 'mock-text-model' });
  const secondManifest = cloneManifest({ id: 'other-provider-model', provider: 'other-provider' });

  registry.registerManifest(firstManifest);
  registry.registerManifest(secondManifest);

  assert.deepEqual(registry.listManifestsByProvider('mock-provider'), [firstManifest]);
});

test('ModelManifestRegistry can list manifests by type', () => {
  const registry = new ModelManifestRegistry();
  const textManifest = cloneManifest({ id: 'mock-text-model', type: 'text' });
  const imageManifest = cloneManifest({ id: 'mock-image-model', type: 'image' });

  registry.registerManifest(textManifest);
  registry.registerManifest(imageManifest);

  assert.deepEqual(registry.listManifestsByType('image'), [imageManifest]);
});

test('default ModelManifestRegistry includes openai-compatible-chat manifest', () => {
  const registry = createDefaultModelManifestRegistry();

  assert.equal(registry.hasManifest('openai-compatible-chat'), true);
  assert.deepEqual(registry.getManifest('openai-compatible-chat'), openaiChatManifest);
  assert.deepEqual(registry.listManifests(), [openaiChatManifest]);
  assert.deepEqual(registry.listManifestsByProvider('openai-compatible'), [openaiChatManifest]);
  assert.deepEqual(registry.listManifestsByType('text'), [openaiChatManifest]);
});