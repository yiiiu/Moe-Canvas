import test from 'node:test';
import assert from 'node:assert/strict';

import {
  testCustomProviderConnection,
} from './customProviderConnectionTestApi.js';
import {
  testProviderConnection,
  testProviderConnections,
} from './providerConnectionTestApi.js';

function createJsonResponse(body, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers,
  });
}

async function withMockedFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('custom provider connection test uses /v1/models probe', async () => {
  const requests = [];

  const result = await withMockedFetch(async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.includes('/api/v2/proxy/task?apiUrl=')) {
      const upstreamUrl = decodeURIComponent(url.split('apiUrl=')[1] || '');
      assert.equal(upstreamUrl, 'https://api.example.com/v1/models');
      assert.equal(init.method, 'GET');
      assert.equal(init.headers?.Authorization, 'Bearer sk-custom');
      return createJsonResponse({ data: [{ id: 'gpt-4o-mini' }] });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }, async () =>
    testCustomProviderConnection(
      'custom_acme',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-custom',
      },
      {
        customProvider: {
          id: 'custom_acme',
          label: 'Acme',
          kind: 'openai-compatible',
          capabilities: ['text', 'connection_test'],
          models: { text: ['gpt-4o-mini'] },
        },
      },
    ),
  );

  assert.equal(result.ok, true);
  assert.equal(result.label, 'Acme');
  assert.equal(result.steps[1].id, 'model');
  assert.equal(result.steps[1].ok, true);
  assert.match(result.steps[1].detail, /v1\/models/);
  assert.equal(requests.length, 1);
});

test('custom provider connection test falls back to chat completion when models probe is unavailable', async () => {
  const requests = [];

  const result = await withMockedFetch(async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });

    if (url.includes('/api/v2/proxy/task?apiUrl=')) {
      return createJsonResponse({ error: 'not found' }, { status: 404 });
    }

    if (url.endsWith('/api/v2/proxy/completions')) {
      const body = JSON.parse(init.body);
      assert.equal(body.apiUrl, 'https://api.example.com/v1/chat/completions');
      assert.equal(body.apiKey, 'sk-custom');
      assert.equal(body.model, 'gpt-4o-mini');
      assert.equal(body.max_tokens, 1);
      assert.deepEqual(body.messages, [{ role: 'user', content: '你好' }]);
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }, async () =>
    testProviderConnection(
      'custom_acme',
      {
        apiUrl: 'https://api.example.com',
        apiKey: 'sk-custom',
      },
      {
        customProvider: {
          id: 'custom_acme',
          label: 'Acme',
          kind: 'openai-compatible',
          capabilities: ['text', 'connection_test'],
          models: { text: ['gpt-4o-mini'] },
        },
      },
    ),
  );

  assert.equal(result.ok, true);
  assert.equal(result.steps[1].id, 'model');
  assert.equal(result.steps[1].ok, true);
  assert.match(result.steps[1].message, /回退测试/);
  assert.equal(requests.length, 2);
});

test('providerConnectionTestApi includes custom providers in batch test results', async () => {
  const result = await withMockedFetch(async (input, init = {}) => {
    const url = String(input);

    if (url.includes('/api/v2/proxy/task?apiUrl=')) {
      const upstreamUrl = decodeURIComponent(url.split('apiUrl=')[1] || '');
      if (upstreamUrl === 'https://api.example.com/v1/models') {
        return createJsonResponse({ data: [{ id: 'gpt-4o-mini' }] });
      }
      return createJsonResponse({ data: [] });
    }

    if (url.endsWith('/api/v2/proxy/completions')) {
      return createJsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }

    if (url.endsWith('/api/v2/proxy/image')) {
      return createJsonResponse({ data: { id: 'task-1' } });
    }

    if (url.endsWith('/api/v2/runninghubwf/query')) {
      return createJsonResponse({ data: { code: 404 } });
    }

    if (url.endsWith('/api/v2/proxy/apimart-upload')) {
      return createJsonResponse({ data: { cdnUrl: 'https://upload.example.com/aic-test.png' } });
    }

    if (url.includes('client/openapi/getAPIKeyCredits') || url.includes('client/common/getCredits')) {
      return createJsonResponse({ data: { credits: 100 } });
    }

    if (url.includes('/user/balance') || url.includes('/v1/balance')) {
      return createJsonResponse({ data: { balance: 100 } });
    }

    if (url.includes('uc/openapi/accountStatus')) {
      return createJsonResponse({ data: { data: { remainCoins: 1000, money: 50, currency: 'CNY' } } });
    }

    if (url.includes('newUploadTokenZH')) {
      return createJsonResponse({ data: { data: { token: 'token', key: 'key', url: 'https://upload.qiniu.example.com' } } });
    }

    if (url === 'https://upload.qiniu.example.com') {
      return createJsonResponse({ ok: true });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }, async () =>
    testProviderConnections({
      providers: {
        custom_acme: {
          apiUrl: 'https://api.example.com',
          apiKey: 'sk-custom',
        },
      },
      customProviders: [
        {
          id: 'custom_acme',
          label: 'Acme',
          kind: 'openai-compatible',
          capabilities: ['text', 'connection_test'],
          models: {
            text: ['gpt-4o-mini'],
          },
        },
      ],
    }),
  );

  assert.ok(result.custom_acme);
  assert.equal(result.custom_acme.ok, true);
  assert.equal(result.custom_acme.label, 'Acme');
});