import test from 'node:test';
import assert from 'node:assert/strict';

import { BaseProviderAdapter } from './baseProviderAdapter.js';
import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
import { PROVIDER_ERROR_CODES, ProviderError } from './providerErrors.js';

async function assertProviderError(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ProviderError && error.code === code,
  );
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function createValidConfig(overrides = {}) {
  return {
    baseURL: 'https://mock-provider.example/v1',
    apiKey: 'test-api-key',
    model: 'gpt-test',
    fetch: async () => jsonResponse(200, {
      id: 'chatcmpl_mock_1',
      model: 'gpt-test',
      choices: [{ message: { role: 'assistant', content: 'mock result' }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    }),
    ...overrides,
  };
}

test('BaseProviderAdapter default methods throw PROVIDER_NOT_IMPLEMENTED', async () => {
  const adapter = new BaseProviderAdapter({});

  await assertProviderError(() => adapter.validateConfig(), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.testConnection(), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitChatCompletion({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.normalizeChatResult({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
});

test('OpenAICompatibleAdapter reports missing baseURL as provider config error', async () => {
  const adapter = new OpenAICompatibleAdapter(createValidConfig({ baseURL: '' }));

  await assertProviderError(() => adapter.validateConfig(), PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING);
});

test('OpenAICompatibleAdapter reports missing apiKey as provider config error', async () => {
  const adapter = new OpenAICompatibleAdapter(createValidConfig({ apiKey: '' }));

  await assertProviderError(() => adapter.validateConfig(), PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING);
});

test('OpenAICompatibleAdapter reports missing model as provider config error', async () => {
  const adapter = new OpenAICompatibleAdapter(createValidConfig({ model: '' }));

  await assertProviderError(() => adapter.validateConfig(), PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING);
});

test('OpenAICompatibleAdapter normalizes mock chat completion text', async () => {
  const requests = [];
  const adapter = new OpenAICompatibleAdapter(createValidConfig({
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return jsonResponse(200, {
        id: 'chatcmpl_mock_2',
        model: 'gpt-test',
        choices: [{ message: { role: 'assistant', content: 'hello from mock' }, finish_reason: 'stop' }],
      });
    },
  }));

  const result = await adapter.submitChatCompletion({
    messages: [{ role: 'user', content: 'hello' }],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://mock-provider.example/v1/chat/completions');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-api-key');
  assert.equal(JSON.parse(requests[0].init.body).model, 'gpt-test');
  assert.equal(result.text, 'hello from mock');
  assert.equal(result.id, 'chatcmpl_mock_2');
  assert.equal(result.model, 'gpt-test');
});

test('OpenAICompatibleAdapter maps 401 to PROVIDER_AUTH_FAILED', async () => {
  const adapter = new OpenAICompatibleAdapter(createValidConfig({
    fetch: async () => jsonResponse(401, { error: { message: 'invalid api key' } }),
  }));

  await assertProviderError(
    () => adapter.submitChatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED,
  );
});

test('OpenAICompatibleAdapter maps 429 to PROVIDER_RATE_LIMIT', async () => {
  const adapter = new OpenAICompatibleAdapter(createValidConfig({
    fetch: async () => jsonResponse(429, { error: { message: 'rate limited' } }),
  }));

  await assertProviderError(
    () => adapter.submitChatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMIT,
  );
});

test('OpenAICompatibleAdapter maps timeout and fetch exceptions to provider errors', async () => {
  const timeoutAdapter = new OpenAICompatibleAdapter(createValidConfig({
    fetch: async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    },
  }));
  const badResponseAdapter = new OpenAICompatibleAdapter(createValidConfig({
    fetch: async () => {
      throw new Error('network socket reset');
    },
  }));

  await assertProviderError(
    () => timeoutAdapter.submitChatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT,
  );
  await assertProviderError(
    () => badResponseAdapter.submitChatCompletion({ messages: [{ role: 'user', content: 'hello' }] }),
    PROVIDER_ERROR_CODES.PROVIDER_BAD_RESPONSE,
  );
});