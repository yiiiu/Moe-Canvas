import test from 'node:test';
import assert from 'node:assert/strict';

function makeJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : null;
      },
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('aiImageApi: local recovery credentials from runtime spec reach proxy image request body', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url) !== '/api/config') throw new Error(`unexpected fetch url: ${url}`);
      return makeJsonResponse({
        providers: {
          grsai: {
            apiUrl: 'https://api.grsai.example.com/',
            apiKey: 'k_grsai',
          },
        },
      });
    };

    const { clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    const {
      buildGenerateImageRequest,
      mergeImageAsyncTaskContextForRequest,
    } = await import('./aiImageApi.js');

    const payloadWithoutLocalIdentity = {
      prompt: 'p',
      provider: 'grsai',
      model: 'nano-banana-pro-vt',
      aspectRatio: '16:9',
      imageSize: '2K',
      inputUrls: [],
    };
    const runtimeOptions = {
      spec: {
        runtimeTaskId: 'async:image:grsai:runtime-1',
        clientTaskId: 'client:runtime-1',
        targetNodeId: 'node-1',
        canvasId: 'canvas-1',
        payload: payloadWithoutLocalIdentity,
      },
    };

    const request = await buildGenerateImageRequest(
      mergeImageAsyncTaskContextForRequest(payloadWithoutLocalIdentity, runtimeOptions),
    );

    assert.equal(request.url, '/api/v2/proxy/image');
    assert.equal(request.body.runtimeTaskId, 'async:image:grsai:runtime-1');
    assert.equal(request.body.clientTaskId, 'client:runtime-1');
    assert.equal(request.body.nodeId, 'node-1');
    assert.equal(request.body.canvasId, 'canvas-1');
    assert.equal(request.body.provider, 'grsai');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('aiImageApi: GRSAI local recovery request with empty frontend api key still reaches proxy image', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url) !== '/api/config') throw new Error(`unexpected fetch url: ${url}`);
      return makeJsonResponse({
        providers: {
          grsai: {
            apiUrl: 'https://api.grsai.example.com/',
            apiKey: '',
          },
        },
      });
    };

    const { clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    const {
      buildGenerateImageRequest,
      mergeImageAsyncTaskContextForRequest,
    } = await import('./aiImageApi.js');

    const payloadWithoutLocalIdentity = {
      prompt: 'p',
      provider: 'grsai',
      model: 'nano-banana-pro-vt',
      aspectRatio: '16:9',
      imageSize: '2K',
      inputUrls: [],
    };
    const runtimeOptions = {
      spec: {
        runtimeTaskId: 'async:image:grsai:runtime-empty-key',
        clientTaskId: 'client:runtime-empty-key',
        targetNodeId: 'node-empty-key',
        canvasId: 'canvas-1',
        payload: payloadWithoutLocalIdentity,
      },
    };

    const request = await buildGenerateImageRequest(
      mergeImageAsyncTaskContextForRequest(payloadWithoutLocalIdentity, runtimeOptions),
    );

    assert.equal(request.url, '/api/v2/proxy/image');
    assert.equal(request.body.runtimeTaskId, 'async:image:grsai:runtime-empty-key');
    assert.equal(request.body.clientTaskId, 'client:runtime-empty-key');
    assert.equal(request.body.nodeId, 'node-empty-key');
    assert.equal(request.body.canvasId, 'canvas-1');
    assert.equal(request.body.provider, 'grsai');
    assert.equal(request.body.apiKey, '');
  } finally {
    globalThis.fetch = previousFetch;
  }
});