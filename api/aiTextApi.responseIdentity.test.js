import test from 'node:test';
import assert from 'node:assert/strict';

import { generateText } from './aiTextApi.js';
import { clearApiConfig } from './configApi.js';

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