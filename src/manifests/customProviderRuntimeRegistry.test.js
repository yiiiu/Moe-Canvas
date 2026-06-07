import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCustomProviderRuntimeManifests,
  getModelManifest,
  listModelManifests,
  resolveModelExecution,
  resolveModelProvider,
  setCustomProviderRuntimeManifests,
} from './index.js';
import { getDisplayModelName } from '../modules/providers.js';

test('custom runtime manifests: 注册后可解析自定义 provider 模型', () => {
  clearCustomProviderRuntimeManifests();

  setCustomProviderRuntimeManifests([
    {
      id: 'custom_acme',
      label: 'Acme',
      kind: 'openai-compatible',
      enabled: true,
      capabilities: ['text', 'image'],
      models: {
        text: ['gpt-4o-mini'],
        image: ['gpt-image-1'],
      },
    },
  ]);

  const textManifest = getModelManifest('custom_acme/gpt-4o-mini');
  assert.equal(textManifest?.provider, 'custom_acme');
  assert.equal(textManifest?.kind, 'text');
  assert.equal(textManifest?.displayName, 'gpt-4o-mini');

  const imageManifest = getModelManifest('custom_acme/gpt-image-1');
  assert.equal(imageManifest?.provider, 'custom_acme');
  assert.equal(imageManifest?.kind, 'image');

  const resolvedExecution = resolveModelExecution('gpt-4o-mini', {
    providerHint: 'custom_acme',
  });
  assert.equal(resolvedExecution?.modelManifest?.modelId, 'custom_acme/gpt-4o-mini');
  assert.equal(
    resolvedExecution?.executionManifest?.id,
    'custom_acme.custom-openai-compatible.text.v1',
  );

  assert.equal(resolveModelProvider('gpt-4o-mini', 'custom_acme'), 'custom_acme');
  assert.equal(getDisplayModelName('custom_acme/gpt-4o-mini'), 'gpt-4o-mini');
  assert.equal(
    listModelManifests().some(model => model.modelId === 'custom_acme/gpt-4o-mini'),
    true,
  );

  clearCustomProviderRuntimeManifests();
  setCustomProviderRuntimeManifests([
    {
      id: 'custom_acme',
      label: 'Acme',
      kind: 'openai-compatible',
      enabled: true,
      capabilities: ['text'],
      models: {
        text: ['custom_acme/gpt-4o-mini'],
      },
    },
  ]);

  const migratedManifest = getModelManifest('custom_acme/gpt-4o-mini');
  assert.equal(migratedManifest?.displayName, 'gpt-4o-mini');
  assert.equal(migratedManifest?.extensions?.rawModelId, 'gpt-4o-mini');
  assert.equal(resolveModelExecution('custom_acme/gpt-4o-mini')?.modelManifest, migratedManifest);

  clearCustomProviderRuntimeManifests();
  assert.equal(resolveModelExecution('gpt-4o-mini', { providerHint: 'custom_acme' }), null);
});