import test from 'node:test';
import assert from 'node:assert/strict';

import { __resetGenerationTaskRuntimeForTest, submitTask } from './generationTaskRuntime.js';
import { loadAsyncTaskRecords } from './asyncTaskStore.js';

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

function createStore(nodes = {}) {
  const state = {
    nodes: { ...nodes },
    activeCanvasId: 'canvas_1',
  };
  return {
    state,
    getState: () => state,
    getStateRaw: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
}

test('generationTaskRuntime: text completion success updates async cache terminal record', async () => {
  __resetGenerationTaskRuntimeForTest();
  const storage = createMemoryStorage();
  const store = createStore({
    'text-node-1': { id: 'text-node-1', type: 'ai-text', canvasId: 'canvas_1' },
  });
  const completion = {
    id: 'resp_text_1',
    text: '文本生成完成',
    model: 'gpt-5.4',
  };

  const result = await submitTask({
    sourceNodeId: 'text-node-1',
    targetNodeId: 'text-node-1',
    trigger: 'submit',
    taskType: 'text-generation',
    provider: 'custom_openai_compatible',
    adapterType: 'modelApi',
    modelId: 'custom_openai_compatible/gpt-5.4',
    executionId: 'text.custom_openai_compatible.gpt-5.4',
    payload: {
      prompt: '生成一句话',
      model: 'custom_openai_compatible/gpt-5.4',
      provider: 'custom_openai_compatible',
      nodeId: 'text-node-1',
    },
    cancellable: false,
    resumable: false,
    async: false,
    submit: async () => completion,
    resultBuilder: async (remoteResult) => ({
      outputText: remoteResult?.text || '',
    }),
  }, {
    store,
    asyncTaskStorage: storage,
    startedAt: 1781464088894,
    now: () => 1781464101000,
  });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, 'text');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].finishedAt, 1781464101000);
  assert.equal(records[0].remoteResultId, 'resp_text_1');
  assert.equal(records[0].resultSpec.outputText, '文本生成完成');
});