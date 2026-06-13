import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiConfig } from './configApi.js';
import { generateImage, mergeImageAsyncTaskContextForRequest } from './aiImageApi.js';
import { loadAsyncTaskRecords, upsertAsyncTaskRecord } from '../src/core/asyncTaskStore.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

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

function makeTextResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type' ? 'text/plain' : null;
      },
    },
    json: async () => JSON.parse(String(payload || '{}')),
    text: async () => String(payload || ''),
  };
}

test('aiImageApi: request payload inherits local recovery ids from runtime spec', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let capturedProxyBody = null;

  try {
    globalThis.window = { currentProjectId: 'project-local-recovery-test' };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url || '');
      if (requestUrl === '/api/config') {
        return makeJsonResponse({
          providers: {
            grsai: {
              apiUrl: 'https://api.grsai.example.com/',
              apiKey: 'k_grsai',
            },
          },
        });
      }
      if (requestUrl === '/api/v2/proxy/image') {
        capturedProxyBody = JSON.parse(String(options.body || '{}'));
        return makeTextResponse(JSON.stringify({
          id: 'grsai-create-result-1',
          status: 'succeeded',
          results: [{ url: 'https://img.example.com/local-recovery-result.png' }],
        }));
      }
      if (requestUrl === '/api/v2/save_output_from_url') {
        return makeJsonResponse({
          path: 'output/local-recovery-result.png',
          localPath: 'output/local-recovery-result.png',
          displayUrl: '/output/local-recovery-result.png',
        });
      }
      throw new Error(`unexpected fetch url: ${requestUrl}`);
    };

    clearApiConfig();
    const result = await generateImage({
      prompt: 'p',
      provider: 'grsai',
      model: 'gpt-image-2',
      mode: 'normal',
      aspectRatio: '1:1',
      imageSize: '2K',
      runtimeTaskId: '',
      clientTaskId: '',
      nodeId: '',
      canvasId: '',
      inputUrls: [],
    }, {
      spec: {
        runtimeTaskId: 'async:image:grsai:node-1:1000',
        clientTaskId: 'client:async:image:grsai:node-1:1000',
        targetNodeId: 'node-1',
        canvasId: 'canvas-1',
        payload: {
          runtimeTaskId: 'async:image:grsai:node-1:1000',
          clientTaskId: 'client:async:image:grsai:node-1:1000',
          nodeId: 'node-1',
          canvasId: 'canvas-1',
        },
      },
    });

    assert.equal(capturedProxyBody.runtimeTaskId, 'async:image:grsai:node-1:1000');
    assert.equal(capturedProxyBody.clientTaskId, 'client:async:image:grsai:node-1:1000');
    assert.equal(capturedProxyBody.nodeId, 'node-1');
    assert.equal(capturedProxyBody.canvasId, 'canvas-1');
    assert.equal(result.localPath, 'output/local-recovery-result.png');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    clearApiConfig();
  }
});

test('aiImageApi: GRSAI proxy request omits empty frontend apiKey so backend can use local config', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let capturedProxyBody = null;

  try {
    globalThis.window = { currentProjectId: 'project-local-recovery-test' };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url || '');
      if (requestUrl === '/api/config') {
        return makeJsonResponse({
          providers: {
            grsai: {
              apiUrl: 'https://api.grsai.example.com/',
              apiKey: '',
            },
          },
        });
      }
      if (requestUrl === '/api/v2/proxy/image') {
        capturedProxyBody = JSON.parse(String(options.body || '{}'));
        return makeTextResponse(JSON.stringify({
          id: 'grsai-create-result-with-local-key',
          status: 'succeeded',
          results: [{ url: 'https://img.example.com/grsai-local-key.png' }],
        }));
      }
      if (requestUrl === '/api/v2/save_output_from_url') {
        return makeJsonResponse({
          path: 'output/grsai-local-key.png',
          localPath: 'output/grsai-local-key.png',
          displayUrl: '/output/grsai-local-key.png',
        });
      }
      throw new Error(`unexpected fetch url: ${requestUrl}`);
    };

    clearApiConfig();
    const result = await generateImage({
      prompt: 'p',
      provider: 'grsai',
      model: 'gpt-image-2',
      mode: 'normal',
      aspectRatio: '1:1',
      imageSize: '2K',
      inputUrls: [],
    }, {
      spec: {
        runtimeTaskId: 'async:image:grsai:node-local-key:1000',
        clientTaskId: 'client:async:image:grsai:node-local-key:1000',
        targetNodeId: 'node-local-key',
        canvasId: 'canvas-1',
      },
    });

    assert.ok(capturedProxyBody);
    assert.equal(Object.prototype.hasOwnProperty.call(capturedProxyBody, 'apiKey'), false);
    assert.equal(capturedProxyBody.provider, 'grsai');
    assert.equal(capturedProxyBody.runtimeTaskId, 'async:image:grsai:node-local-key:1000');
    assert.equal(result.localPath, 'output/grsai-local-key.png');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    clearApiConfig();
  }
});

test('aiImageApi: local recovery context merge fills empty request fields from spec', () => {
  const payload = mergeImageAsyncTaskContextForRequest({
    provider: 'grsai',
    model: 'gpt-image-2',
    runtimeTaskId: '',
    clientTaskId: '',
    nodeId: '',
    canvasId: '',
  }, {
    spec: {
      runtimeTaskId: 'runtime-1',
      clientTaskId: 'client-1',
      targetNodeId: 'node-1',
      canvasId: 'canvas-1',
    },
  });

  assert.equal(payload.runtimeTaskId, 'runtime-1');
  assert.equal(payload.clientTaskId, 'client-1');
  assert.equal(payload.nodeId, 'node-1');
  assert.equal(payload.canvasId, 'canvas-1');
});

test('aiImageApi: GRSAI result ids do not create orphan polling records', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  let capturedProxyBody = null;

  try {
    globalThis.localStorage = storage;
    globalThis.window = { currentProjectId: 'project-local-recovery-test' };
    upsertAsyncTaskRecord({
      runtimeTaskId: 'async:image:grsai:node-1:1000',
      clientTaskId: 'client:async:image:grsai:node-1:1000',
      kind: 'image',
      provider: 'grsai',
      modelId: 'gpt-image-2',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      status: 'running',
      createdAt: 1000,
      updatedAt: 1000,
    }, { storage, now: 1000 });

    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url || '');
      if (requestUrl === '/api/config') {
        return makeJsonResponse({
          providers: {
            grsai: {
              apiUrl: 'https://api.grsai.example.com/',
              apiKey: 'k_grsai',
            },
          },
        });
      }
      if (requestUrl === '/api/v2/proxy/image') {
        capturedProxyBody = JSON.parse(String(options.body || '{}'));
        return makeTextResponse(JSON.stringify({
          id: 'remote-result-id-1',
          resultId: 'remote-result-id-1',
          remoteResultId: 'remote-result-id-1',
          status: 'succeeded',
          results: [{ url: 'https://img.example.com/grsai-result.png' }],
        }));
      }
      if (requestUrl === '/api/v2/save_output_from_url') {
        return makeJsonResponse({
          path: 'output/grsai-result.png',
          localPath: 'output/grsai-result.png',
          displayUrl: '/output/grsai-result.png',
        });
      }
      throw new Error(`unexpected fetch url: ${requestUrl}`);
    };

    clearApiConfig();
    const result = await generateImage({
      prompt: 'p',
      provider: 'grsai',
      model: 'gpt-image-2',
      mode: 'normal',
      aspectRatio: '1:1',
      imageSize: '2K',
      inputUrls: [],
    }, {
      spec: {
        runtimeTaskId: 'async:image:grsai:node-1:1000',
        clientTaskId: 'client:async:image:grsai:node-1:1000',
        targetNodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    });

    const records = loadAsyncTaskRecords({ storage });
    assert.equal(Object.prototype.hasOwnProperty.call(capturedProxyBody, 'apiKey'), false);
    assert.equal(capturedProxyBody.runtimeTaskId, 'async:image:grsai:node-1:1000');
    assert.equal(result.localPath, 'output/grsai-result.png');
    assert.equal(records.length, 1);
    assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:1000');
    assert.equal(records[0].clientTaskId, 'client:async:image:grsai:node-1:1000');
    assert.equal(records[0].nodeId, 'node-1');
    assert.equal(records[0].queryableTaskId, '');
    assert.equal(records[0].pollingTaskId, '');
    assert.equal(records.some((record) => record.runtimeTaskId === 'async:image:grsai:node-1:remote-result-id-1'), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    if (typeof originalStorage === 'undefined') {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = originalStorage;
    }
    clearApiConfig();
  }
});
