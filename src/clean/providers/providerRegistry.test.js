import test from 'node:test';
import assert from 'node:assert/strict';

import { BaseProviderAdapter } from './baseProviderAdapter.js';
import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
import {
  createDefaultProviderRegistry,
  ProviderRegistry,
} from './providerRegistry.js';
import { PROVIDER_ERROR_CODES, ProviderError } from './providerErrors.js';

class MockProviderAdapter extends BaseProviderAdapter {}

function assertProviderError(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ProviderError && error.code === code,
  );
}

test('ProviderRegistry can register and get provider adapter class', () => {
  const registry = new ProviderRegistry();

  const returned = registry.registerProvider('mock-provider', MockProviderAdapter);

  assert.equal(returned, registry);
  assert.equal(registry.getProvider('mock-provider'), MockProviderAdapter);
});

test('ProviderRegistry can check provider presence', () => {
  const registry = new ProviderRegistry();

  registry.registerProvider('mock-provider', MockProviderAdapter);

  assert.equal(registry.hasProvider('mock-provider'), true);
  assert.equal(registry.hasProvider('missing-provider'), false);
});

test('ProviderRegistry can list registered providers', () => {
  const registry = new ProviderRegistry();

  registry.registerProvider('mock-provider', MockProviderAdapter);

  assert.deepEqual(registry.listProviders(), [
    {
      id: 'mock-provider',
      name: 'MockProviderAdapter',
      adapterClass: MockProviderAdapter,
    },
  ]);
});

test('ProviderRegistry can create provider adapter instance', () => {
  const registry = new ProviderRegistry();
  const config = { apiKey: 'mock-key' };

  registry.registerProvider('mock-provider', MockProviderAdapter);
  const adapter = registry.createProvider('mock-provider', config);

  assert.equal(adapter instanceof MockProviderAdapter, true);
  assert.deepEqual(adapter.config, config);
});

test('ProviderRegistry rejects duplicate provider id', () => {
  const registry = new ProviderRegistry();

  registry.registerProvider('mock-provider', MockProviderAdapter);

  assertProviderError(
    () => registry.registerProvider('mock-provider', MockProviderAdapter),
    PROVIDER_ERROR_CODES.PROVIDER_ALREADY_REGISTERED,
  );
});

test('ProviderRegistry rejects missing provider lookup', () => {
  const registry = new ProviderRegistry();

  assertProviderError(
    () => registry.getProvider('missing-provider'),
    PROVIDER_ERROR_CODES.PROVIDER_NOT_FOUND,
  );
  assertProviderError(
    () => registry.createProvider('missing-provider', {}),
    PROVIDER_ERROR_CODES.PROVIDER_NOT_FOUND,
  );
});

test('ProviderRegistry rejects invalid adapter class', () => {
  const registry = new ProviderRegistry();

  assertProviderError(
    () => registry.registerProvider('invalid-provider', {}),
    PROVIDER_ERROR_CODES.PROVIDER_INVALID_ADAPTER,
  );
});

test('default ProviderRegistry includes openai-compatible adapter', () => {
  const registry = createDefaultProviderRegistry();

  assert.equal(registry.hasProvider('openai-compatible'), true);
  assert.equal(registry.getProvider('openai-compatible'), OpenAICompatibleAdapter);
  assert.deepEqual(registry.listProviders(), [
    {
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      adapterClass: OpenAICompatibleAdapter,
    },
  ]);
});