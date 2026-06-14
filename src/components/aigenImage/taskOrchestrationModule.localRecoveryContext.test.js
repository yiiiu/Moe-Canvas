import test from 'node:test';
import assert from 'node:assert/strict';

import { createAIGenerateNodeTaskOrchestrationModule } from './taskOrchestrationModule.js';
import { __resetGenerationTaskRuntimeForTest } from '../../core/generationTaskRuntime.js';

function createStore(state, incomingEdges = []) {
  return {
    getState() {
      return state;
    },
    getIncomingEdges(targetId) {
      return incomingEdges.filter((edge) => edge?.targetId === targetId);
    },
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = {
        ...(state.nodes[nodeId] || {}),
        ...(patch || {}),
      };
    },
  };
}

function createPromptEl(text = 'prompt') {
  return {
    innerText: text,
    textContent: text,
    childNodes: [
      {
        nodeType: 3,
        textContent: text,
      },
    ],
  };
}

function createNodeContext({ nodeId, state, api }) {
  const store = createStore(state);
  const module = createAIGenerateNodeTaskOrchestrationModule({
    store,
    api,
    getRefKindByNodeType: () => null,
    getImage: async () => null,
    ensureConfig: async () => {},
    getProviderConfig: () => ({ apiKey: 'k_grsai' }),
    startLoading: () => {},
    stopLoading: () => {},
  });

  Object.assign(module, {
    nodeId,
    _data: state.nodes[nodeId],
    promptEl: createPromptEl('local recovery prompt'),
    _isRunninghubWorkflowModel: () => false,
    _syncLocalTaskNodeData() {
      this._data = state.nodes[nodeId];
      return this._data;
    },
    _persistAsyncResumeCache: () => {},
    _persistRunningHubResumeCache: () => {},
    _persistDreaminaResumeCache: () => {},
    _updateSubmitButtonState: () => {},
    _dispatchGenerationHistoryAssets: () => {},
  });

  return { module, store };
}

test('aigenImage task orchestration: generateImage receives runtime spec local recovery context', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    globalThis.window = {
      showToast: () => {},
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-local-recovery-context';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
        },
      },
    };

    let captured = null;
    const api = {
      generateImage: async (payload, options) => {
        captured = { payload, options };
        return {
          imageUrl: '/output/local-recovery-context.png',
          images: [{ imageUrl: '/output/local-recovery-context.png' }],
        };
      },
    };

    const { module } = createNodeContext({ nodeId, state, api });

    const result = await module._onGenerate();

    assert.equal(result.status, 'success');
    assert.ok(captured);
    assert.equal(captured.options.spec.targetNodeId, nodeId);
    assert.equal(captured.options.spec.sourceNodeId, nodeId);
    assert.match(captured.options.spec.runtimeTaskId, /^async:image:grsai:/);
    assert.equal(captured.options.spec.clientTaskId, `client:${captured.options.spec.runtimeTaskId}`);
    assert.equal(captured.payload.runtimeTaskId, captured.options.spec.runtimeTaskId);
    assert.equal(captured.payload.clientTaskId, captured.options.spec.clientTaskId);
    assert.equal(captured.payload.nodeId, nodeId);
    assert.equal(captured.payload.provider, 'grsai');
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});

test('aigenImage task orchestration: aborted GRSAI local recovery request stays paused instead of failed', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    globalThis.window = {
      showToast: () => {},
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-local-recovery-abort';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
          generationDuration: null,
        },
      },
    };

    let moduleRef = null;
    let capturedOptions = null;
    const api = {
      generateImage: async (payload, options) => {
        capturedOptions = options;
        moduleRef?._rhAbortController?.abort();
        throw new Error('[GRSAI] 网络连接失败，请检查网络或代理设置');
      },
    };

    const { module } = createNodeContext({ nodeId, state, api });
    moduleRef = module;

    const result = await module._onGenerate();
    const node = state.nodes[nodeId];

    assert.equal(capturedOptions?.signal?.aborted, true);
    assert.equal(result.status, 'paused');
    assert.equal(node.isGenerating, true);
    assert.equal(node.jobError, null);
    assert.notEqual(node.jobStatus, 'error');
    assert.notEqual(node.asyncTaskStatus, 'failed');
    assert.equal(node.generationDuration, null);
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});

test('aigenImage task orchestration: GRSAI local proxy network interruption stays recoverable', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    globalThis.window = {
      showToast: () => {},
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-local-recovery-network';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
          generationDuration: null,
        },
      },
    };

    const api = {
      generateImage: async () => {
        throw new Error('[GRSAI] 网络连接失败，请检查网络或代理设置');
      },
    };

    const { module } = createNodeContext({ nodeId, state, api });
    const result = await module._onGenerate();
    const node = state.nodes[nodeId];

    assert.equal(result.status, 'paused');
    assert.equal(node.isGenerating, true);
    assert.equal(node.jobError, null);
    assert.notEqual(node.jobStatus, 'error');
    assert.notEqual(node.asyncTaskStatus, 'failed');
    assert.equal(node.generationDuration, null);
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});

test('aigenImage task orchestration: recovered GRSAI node with empty api key still reaches generation request', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    const toastMessages = [];
    globalThis.window = {
      showToast: (message) => toastMessages.push(String(message || '')),
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-local-recovery-empty-key';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          apiKey: '',
          apikey: '',
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
        },
      },
    };

    let captured = null;
    const api = {
      generateImage: async (payload, options) => {
        captured = { payload, options };
        return {
          imageUrl: '/output/local-recovery-empty-key.png',
          images: [{ imageUrl: '/output/local-recovery-empty-key.png' }],
        };
      },
    };

    const { module } = createNodeContext({ nodeId, state, api });
    module.getProviderConfig = () => ({ apiKey: '' });

    const result = await module._onGenerate();

    assert.equal(result.status, 'success');
    assert.ok(captured);
    assert.equal(captured.payload.provider, 'grsai');
    assert.equal(captured.payload.nodeId, nodeId);
    assert.match(captured.options.spec.runtimeTaskId, /^async:image:grsai:/);
    assert.equal(toastMessages.some((message) => message.toLowerCase().includes('apikey is empty')), false);
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});

test('aigenImage task orchestration: stale recovered GRSAI instance can retry when store is idle', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    globalThis.window = {
      showToast: () => {},
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-stale-recovered-instance';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          asyncTaskProvider: 'grsai',
          asyncTaskKind: 'image',
          asyncTaskId: '',
          asyncTaskStatus: 'interrupted',
          asyncTaskRecovering: false,
          isGenerating: false,
          jobStatus: 'idle',
          generationStartTime: 0,
          generationDuration: null,
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
        },
      },
    };

    let captured = null;
    const api = {
      generateImage: async (payload, options) => {
        captured = { payload, options };
        return {
          imageUrl: '/output/stale-recovered-retry.png',
          images: [{ imageUrl: '/output/stale-recovered-retry.png' }],
        };
      },
    };

    const { module } = createNodeContext({ nodeId, state, api });
    module._isGenerating = true;

    const result = await module._handleGenerateOrCancel();

    assert.equal(result?.status, 'success');
    assert.ok(captured);
    assert.equal(captured.payload.provider, 'grsai');
    assert.equal(captured.payload.nodeId, nodeId);
    assert.match(captured.options.spec.runtimeTaskId, /^async:image:grsai:/);
    assert.equal(module._isGenerating, false);
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});

test('aigenImage task orchestration: failed GRSAI proxy response writes failure state instead of success', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNode = globalThis.Node;

  try {
    __resetGenerationTaskRuntimeForTest();
    globalThis.window = {
      showToast: () => {},
      ensureSubscriptionInstallId: async () => '',
    };
    globalThis.document = {
      getElementById: () => null,
    };
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    };

    const nodeId = 'node-ai-image-grsai-failed-response';
    const state = {
      nodes: {
        [nodeId]: {
          id: nodeId,
          model: 'gpt-image-2',
          provider: 'grsai',
          aspectRatio: '1:1',
          imageSize: '2K',
          batchSize: 1,
        },
      },
    };

    const api = {
      generateImage: async () => ({
        id: 'task-credit-empty',
        status: 'failed',
        error: 'apikey credits not enough',
      }),
    };

    const { module } = createNodeContext({ nodeId, state, api });

    const result = await module._onGenerate();
    const node = state.nodes[nodeId];

    assert.notEqual(result.status, 'success');
    assert.equal(node.isGenerating, false);
    assert.equal(node.jobStatus, 'error');
    assert.equal(node.jobError, 'apikey credits not enough');
    assert.deepEqual(node.images, []);
    assert.equal(node.imageUrl, '');
  } finally {
    __resetGenerationTaskRuntimeForTest();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalNode === undefined) delete globalThis.Node;
    else globalThis.Node = originalNode;
  }
});
