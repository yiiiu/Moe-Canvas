import test from 'node:test';
import assert from 'node:assert/strict';

import { generateText } from './aiTextApi.js';
import { clearApiConfig } from './configApi.js';

const CUSTOM_PROVIDER_ID = 'custom_acme';
const CUSTOM_API_URL = 'https://api.example.com';
const CUSTOM_API_KEY = 'k_custom';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('aiTextApi: proxy chat completion keeps terminal response identity', async () => {
  const originalFetch = globalThis.fetch;
  clearApiConfig();
  globalThis.fetch = async (target) => {
    const url = String(target || '');
    if (url === '/api/config') {
      return jsonResponse({
        providers: {
          openai: {
            apiUrl: 'https://api.openai-compatible.local/v1',
            apiKey: 'k_openai_compatible',
          },
        },
      });
    }
    if (url === '/api/v2/proxy/completions') {
      return jsonResponse({
        id: 'resp_text_1',
        object: 'chat.completion',
        created: 1781464101,
        model: 'gpt-5.4',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: '文本生成完成',
          },
          finish_reason: 'stop',
        }],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  try {
    const result = await generateText({
      provider: 'custom',
      model: 'gpt-5.4',
      prompt: '生成一句话',
    });

    assert.equal(result.text, '文本生成完成');
    assert.equal(result.id, 'resp_text_1');
    assert.equal(result.model, 'gpt-5.4');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiConfig();
  }
});

test('aiTextApi: proxy chat completion forwards local recovery identity', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies = [];
  clearApiConfig();
  globalThis.fetch = async (target, init = {}) => {
    const url = String(target || '');
    if (url === '/api/config') {
      return jsonResponse({
        providers: {
          openai: {
            apiUrl: 'https://api.openai-compatible.local/v1',
            apiKey: 'k_openai_compatible',
          },
        },
      });
    }
    if (url === '/api/v2/proxy/completions') {
      capturedBodies.push(JSON.parse(String(init.body || '{}')));
      return jsonResponse({
        id: 'resp_text_2',
        object: 'chat.completion',
        model: 'gpt-5.4',
        choices: [{ message: { role: 'assistant', content: '文本生成完成' } }],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  try {
    await generateText({
      provider: 'custom',
      model: 'gpt-5.4',
      prompt: '生成一句话',
      runtimeTaskId: 'runtime-text-1',
      clientTaskId: 'client-text-1',
      nodeId: 'text-node-1',
      canvasId: 'canvas-1',
      kind: 'text',
    });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].runtimeTaskId, 'runtime-text-1');
    assert.equal(capturedBodies[0].clientTaskId, 'client-text-1');
    assert.equal(capturedBodies[0].nodeId, 'text-node-1');
    assert.equal(capturedBodies[0].canvasId, 'canvas-1');
    assert.equal(capturedBodies[0].provider, 'custom');
    assert.equal(capturedBodies[0].kind, 'text');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiConfig();
  }
});

test('aiTextApi: custom_openai_compatible local recovery uses local completions proxy', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies = [];
  clearApiConfig();
  globalThis.fetch = async (target, init = {}) => {
    const url = String(target || '');
    if (url === '/api/config') {
      return jsonResponse({
        providers: {
          openai: {
            apiUrl: 'https://api.openai-compatible.local/v1',
            apiKey: 'k_openai_compatible',
          },
          custom_openai_compatible: {
            apiUrl: 'https://api.openai-compatible.local/v1',
            apiKey: 'k_openai_compatible',
          },
        },
      });
    }
    if (url === '/api/v2/proxy/completions') {
      capturedBodies.push(JSON.parse(String(init.body || '{}')));
      return jsonResponse({
        id: 'resp_text_3',
        object: 'chat.completion',
        model: 'gpt-5.4',
        choices: [{ message: { role: 'assistant', content: '文本生成完成' } }],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  try {
    await generateText({
      provider: 'custom_openai_compatible',
      model: 'custom_openai_compatible/gpt-5.4',
      prompt: '生成一句话',
      runtimeTaskId: 'runtime-text-2',
      clientTaskId: 'client-text-2',
      nodeId: 'text-node-2',
      canvasId: 'canvas-1',
      kind: 'text',
    });

    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].runtimeTaskId, 'runtime-text-2');
    assert.equal(capturedBodies[0].clientTaskId, 'client-text-2');
    assert.equal(capturedBodies[0].nodeId, 'text-node-2');
    assert.equal(capturedBodies[0].canvasId, 'canvas-1');
    assert.equal(capturedBodies[0].provider, 'custom_openai_compatible');
    assert.equal(capturedBodies[0].kind, 'text');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiConfig();
  }
});

test('aiTextApi: custom provider manifest text execution forwards local recovery identity', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies = [];
  clearApiConfig();
  globalThis.fetch = async (target, init = {}) => {
    const url = String(target || '');
    if (url === '/api/config') {
      return jsonResponse({
        providers: {
          [CUSTOM_PROVIDER_ID]: {
            apiUrl: CUSTOM_API_URL,
            apiKey: CUSTOM_API_KEY,
            enabled: true,
          },
        },
        customProviders: [
          {
            id: CUSTOM_PROVIDER_ID,
            label: 'Acme',
            kind: 'openai-compatible',
            enabled: true,
            capabilities: ['text'],
            models: {
              text: ['gpt-5.5'],
            },
          },
        ],
      });
    }
    if (url === '/api/v2/proxy/completions') {
      capturedBodies.push(JSON.parse(String(init.body || '{}')));
      return jsonResponse({
        id: 'resp_text_4',
        object: 'chat.completion',
        model: 'gpt-5.5',
        choices: [{ message: { role: 'assistant', content: '文本生成完成' } }],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  try {
    const result = await generateText({
      provider: CUSTOM_PROVIDER_ID,
      model: 'gpt-5.5',
      prompt: '生成一句话',
      runtimeTaskId: 'runtime-text-manifest-2',
      clientTaskId: 'client-text-manifest-2',
      nodeId: 'text-node-manifest-2',
      canvasId: 'canvas-manifest-2',
      kind: 'text',
    });

    assert.equal(result.text, '文本生成完成');
    assert.equal(capturedBodies.length, 1);
    assert.equal(capturedBodies[0].runtimeTaskId, 'runtime-text-manifest-2');
    assert.equal(capturedBodies[0].clientTaskId, 'client-text-manifest-2');
    assert.equal(capturedBodies[0].nodeId, 'text-node-manifest-2');
    assert.equal(capturedBodies[0].canvasId, 'canvas-manifest-2');
    assert.equal(capturedBodies[0].provider, CUSTOM_PROVIDER_ID);
    assert.equal(capturedBodies[0].kind, 'text');
  } finally {
    globalThis.fetch = originalFetch;
    clearApiConfig();
  }
});