import test from 'node:test';
import assert from 'node:assert/strict';

import { startGenerationRecoveryV2 } from './generationRecoveryV2.js';
import { loadAsyncTaskRecords } from './asyncTaskStore.js';

function createStore(nodes = {}) {
  const state = { nodes: { ...nodes } };
  return {
    getState() {
      return state;
    },
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
}

function createManager() {
  const updates = [];
  return {
    updates,
    upsertTask(task) {
      updates.push(task);
      return task;
    },
  };
}

function createStrictSubscribableStore(nodes = {}) {
  const state = { nodes: { ...nodes } };
  const listeners = new Set();
  return {
    getState() {
      return state;
    },
    updateNodeData(nodeId, patch) {
      if (!state.nodes[nodeId]) throw new Error(`[store] updateNodeData() 找不到 id 为 "${nodeId}" 的节点`);
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addNode(node) {
      state.nodes[node.id] = node;
      listeners.forEach((listener) => listener());
    },
  };
}

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

function createLocalProxyTask(overrides = {}) {
  const recoverySpecOverrides = overrides.recoverySpec || {};
  const unifiedTaskOverrides = overrides.unifiedTask || {};
  const taskOverrides = { ...overrides };
  delete taskOverrides.recoverySpec;
  delete taskOverrides.unifiedTask;
  return {
    taskId: 'generation:node-1:runtime-grsai-1',
    nodeId: 'node-1',
    kind: 'imageGeneration',
    status: 'processing',
    provider: 'grsai',
    createdAt: 100,
    startedAt: 100,
    updatedAt: 100,
    ...taskOverrides,
    recoverySpec: {
      kind: 'generation',
      taskType: 'image-generation',
      provider: 'grsai',
      recoveryMode: 'local_proxy_poll',
      targetNodeId: 'node-1',
      taskId: 'runtime-grsai-1',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      startedAt: 100,
      payload: {
        provider: 'grsai',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
      },
      ...recoverySpecOverrides,
    },
    unifiedTask: {
      id: 'generation:node-1:runtime-grsai-1',
      kind: 'image',
      status: 'running',
      nodeId: 'node-1',
      provider: 'grsai',
      canResume: true,
      createdAt: 100,
      updatedAt: 100,
      ...unifiedTaskOverrides,
    },
  };
}

function createTextLocalProxyTask(overrides = {}) {
  const recoverySpecOverrides = overrides.recoverySpec || {};
  const unifiedTaskOverrides = overrides.unifiedTask || {};
  const taskOverrides = { ...overrides };
  delete taskOverrides.recoverySpec;
  delete taskOverrides.unifiedTask;
  return {
    taskId: 'generation:text-node-1:runtime-text-1',
    nodeId: 'text-node-1',
    kind: 'text-generation',
    status: 'processing',
    provider: 'custom_openai_compatible',
    createdAt: 100,
    startedAt: 100,
    updatedAt: 100,
    ...taskOverrides,
    recoverySpec: {
      kind: 'generation',
      taskType: 'text-generation',
      provider: 'custom_openai_compatible',
      recoveryMode: 'local_proxy_poll',
      targetNodeId: 'text-node-1',
      taskId: 'runtime-text-1',
      runtimeTaskId: 'runtime-text-1',
      clientTaskId: 'client-text-1',
      startedAt: 100,
      payload: {
        provider: 'custom_openai_compatible',
        runtimeTaskId: 'runtime-text-1',
        clientTaskId: 'client-text-1',
      },
      ...recoverySpecOverrides,
    },
    unifiedTask: {
      id: 'generation:text-node-1:runtime-text-1',
      kind: 'text',
      status: 'running',
      nodeId: 'text-node-1',
      provider: 'custom_openai_compatible',
      canResume: true,
      createdAt: 100,
      updatedAt: 100,
      ...unifiedTaskOverrides,
    },
  };
}

function createRemotePollTask() {
  return {
    taskId: 'generation:node-2:poll-1',
    nodeId: 'node-2',
    kind: 'imageGeneration',
    status: 'processing',
    provider: 'apimart',
    createdAt: 100,
    startedAt: 100,
    updatedAt: 100,
    recoverySpec: {
      kind: 'generation',
      taskType: 'image-generation',
      provider: 'apimart',
      recoveryMode: 'remote_poll',
      targetNodeId: 'node-2',
      taskId: 'poll-1',
      pollingTaskId: 'poll-1',
      queryableTaskId: 'poll-1',
      pollUrl: 'https://provider.example/tasks/poll-1/status',
      startedAt: 100,
      payload: {
        provider: 'apimart',
      },
    },
    unifiedTask: {
      id: 'generation:node-2:poll-1',
      kind: 'image',
      status: 'running',
      nodeId: 'node-2',
      provider: 'apimart',
      canResume: true,
      createdAt: 100,
      updatedAt: 100,
    },
  };
}

test('generationRecoveryV2 local proxy continues polling pending until success', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' },
  });
  const manager = createManager();
  const scheduled = [];
  const requestedUrls = [];
  const responses = [
    { status: 'running', pending: true, result: null },
    {
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      nodeId: 'node-1',
      provider: 'grsai',
      kind: 'image',
      status: 'success',
      result: {
        id: '13-4f3a79c6-ba0d-48f8-bf49-1a73a01064c5',
        status: 'succeeded',
        results: [
          { url: 'https://file5.aitohumanize.com/file/88d79d9f3b8f4fa3bf2749fa1321586d.png' },
        ],
        progress: 100,
      },
      httpStatus: 200,
      contentType: 'application/json',
    },
  ];

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      const payload = responses.shift();
      return { ok: true, json: async () => payload };
    },
  });

  await session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 2000);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
  assert.ok(requestedUrls[0].includes('runtimeTaskId=runtime-grsai-1'));
  assert.ok(requestedUrls[0].includes('clientTaskId=client-grsai-1'));
  assert.equal(store.getState().nodes['node-1'].isGenerating, true);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'loading');
  assert.equal(store.getState().nodes['node-1'].asyncTaskRecovering, true);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'pending');
  assert.equal(store.getState().nodes['node-1'].generationStartTime, 100);

  await scheduled.shift().fn();
  await session.flush();

  assert.equal(requestedUrls.length, 2);
  assert.equal(scheduled.length, 0);
  assert.equal(store.getState().nodes['node-1'].imageUrl, 'https://file5.aitohumanize.com/file/88d79d9f3b8f4fa3bf2749fa1321586d.png');
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'success');
  assert.equal(manager.updates.at(-1).status, 'success');
});

test('generationRecoveryV2 local proxy continues timer from restored node start time', async () => {
  const restoredTask = createLocalProxyTask();
  delete restoredTask.startedAt;
  delete restoredTask.createdAt;
  delete restoredTask.updatedAt;
  delete restoredTask.recoverySpec.startedAt;
  delete restoredTask.unifiedTask.createdAt;
  delete restoredTask.unifiedTask.updatedAt;

  const store = createStore({
    'node-1': {
      id: 'node-1',
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 12000,
      asyncTaskStartedAt: 12000,
    },
  });
  const manager = createManager();
  const scheduled = [];

  const session = startGenerationRecoveryV2([restoredTask], manager, {
    store,
    now: () => 42000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({ status: 'running', pending: true }) }),
  });

  await session.flush();

  assert.equal(store.getState().nodes['node-1'].generationStartTime, 12000);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStartedAt, 12000);
  assert.equal(scheduled.length, 1);
});

test('generationRecoveryV2 local proxy continues timer when target node loads after recovery starts', async () => {
  const restoredTask = createLocalProxyTask();
  delete restoredTask.startedAt;
  delete restoredTask.createdAt;
  delete restoredTask.updatedAt;
  delete restoredTask.recoverySpec.startedAt;
  delete restoredTask.unifiedTask.createdAt;
  delete restoredTask.unifiedTask.updatedAt;

  const store = createStrictSubscribableStore({});
  const manager = createManager();
  const scheduled = [];
  let fetchCount = 0;

  const session = startGenerationRecoveryV2([restoredTask], manager, {
    store,
    now: () => 42000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ status: 'running', pending: true }) };
    },
  });

  await session.flush();
  assert.equal(fetchCount, 0);

  store.addNode({
    id: 'node-1',
    isGenerating: true,
    jobStatus: 'loading',
    generationStartTime: 12000,
    asyncTaskStartedAt: 12000,
  });
  await session.flush();

  assert.equal(fetchCount, 1);
  assert.equal(store.getState().nodes['node-1'].generationStartTime, 12000);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStartedAt, 12000);
  assert.equal(scheduled.length, 1);
});

test('generationRecoveryV2 local proxy treats nested succeeded image result as terminal', async () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 100,
      asyncRuntimeTaskId: 'runtime-grsai-1',
      asyncClientTaskId: 'client-grsai-1',
      asyncTaskId: 'runtime-grsai-1',
    },
  });
  const manager = createManager();
  const scheduled = [];

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        nodeId: 'node-1',
        provider: 'grsai',
        kind: 'image',
        status: 'running',
        result: {
          id: '13-4f3a79c6-ba0d-48f8-bf49-1a73a01064c5',
          status: 'succeeded',
          results: [
            { url: 'https://file5.aitohumanize.com/file/final.png' },
          ],
          progress: 100,
        },
        httpStatus: 200,
        contentType: 'application/json',
      }),
    }),
  });

  await session.flush();

  assert.equal(scheduled.length, 0);
  assert.equal(store.getState().nodes['node-1'].imageUrl, 'https://file5.aitohumanize.com/file/final.png');
  assert.equal(store.getState().nodes['node-1'].sourceUrl, 'https://file5.aitohumanize.com/file/final.png');
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'success');
  assert.equal(store.getState().nodes['node-1'].generationStartTime, null);
  assert.equal(store.getState().nodes['node-1'].asyncRuntimeTaskId, null);
  assert.equal(store.getState().nodes['node-1'].asyncClientTaskId, null);
  assert.equal(store.getState().nodes['node-1'].asyncTaskId, null);
  assert.equal(store.getState().nodes['node-1'].rhTaskId, null);
  assert.equal(store.getState().nodes['node-1'].dreaminaSubmitId, null);
  assert.equal(store.getState().nodes['node-1'].asyncTaskRecovering, false);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'success');
  assert.equal(manager.updates.at(-1).status, 'success');
});

test('generationRecoveryV2 local proxy writes image from cached json body string', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading', generationStartTime: 100 },
  });
  const manager = createManager();

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal image result must not schedule retry');
    },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        nodeId: 'node-1',
        provider: 'grsai',
        kind: 'image',
        status: 'success',
        result: {
          body: JSON.stringify({
            status: 'succeeded',
            results: [{ url: 'https://file5.aitohumanize.com/file/body-final.png' }],
          }),
        },
        httpStatus: 200,
        contentType: 'application/json',
      }),
    }),
  });

  await session.flush();

  assert.equal(store.getState().nodes['node-1'].imageUrl, 'https://file5.aitohumanize.com/file/body-final.png');
  assert.equal(store.getState().nodes['node-1'].images.length, 1);
  assert.equal(store.getState().nodes['node-1'].images[0].imageUrl, 'https://file5.aitohumanize.com/file/body-final.png');
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'success');
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(manager.updates.at(-1).status, 'success');
});

test('generationRecoveryV2 local proxy saves remote image into output before terminal display', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading', generationStartTime: 100 },
  });
  const manager = createManager();
  const storage = createMemoryStorage();
  const savedUrls = [];

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal image result must not schedule retry');
    },
    clearTimeout() {},
    saveOutputFromUrl: async ({ url }) => {
      savedUrls.push(url);
      return {
        path: 'output/v2-recovered-final.png',
        localPath: 'output/v2-recovered-final.png',
        displayUrl: '/output/v2-recovered-final.png',
      };
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        nodeId: 'node-1',
        provider: 'grsai',
        kind: 'image',
        status: 'success',
        result: {
          status: 'succeeded',
          results: [{ url: 'https://file5.aitohumanize.com/file/remote-final.png' }],
        },
        httpStatus: 200,
        contentType: 'application/json',
      }),
    }),
  });

  await session.flush();

  assert.deepEqual(savedUrls, ['https://file5.aitohumanize.com/file/remote-final.png']);
  assert.equal(store.getState().nodes['node-1'].imageUrl, '/output/v2-recovered-final.png');
  assert.equal(store.getState().nodes['node-1'].localPath, 'output/v2-recovered-final.png');
  assert.equal(store.getState().nodes['node-1'].displayLocalPath, 'output/v2-recovered-final.png');
  assert.equal(store.getState().nodes['node-1'].images[0].localPath, 'output/v2-recovered-final.png');

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records[0].resultSpec.imageUrl, '/output/v2-recovered-final.png');
  assert.equal(records[0].resultSpec.localPath, 'output/v2-recovered-final.png');
  assert.equal(records[0].resultSpec.thumbUrl, '/output/v2-recovered-final.png');
  assert.equal(Object.hasOwn(records[0].resultSpec, 'displayLocalPath'), false);
  assert.equal(Object.hasOwn(records[0].resultSpec, 'sourceUrl'), false);
});

test('generationRecoveryV2 refuses terminal node writeback when canvas id mismatches', async () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-actual',
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 100,
    },
  });
  const manager = createManager();

  const session = startGenerationRecoveryV2([
    createLocalProxyTask({
      canvasId: 'canvas-other',
      recoverySpec: { canvasId: 'canvas-other' },
      unifiedTask: { canvasId: 'canvas-other' },
    }),
  ], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal image result must not schedule retry');
    },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        nodeId: 'node-1',
        provider: 'grsai',
        kind: 'image',
        status: 'success',
        result: {
          status: 'succeeded',
          results: [{ url: '/output/canvas-mismatch.png' }],
        },
      }),
    }),
  });

  await session.flush();

  assert.equal(store.getState().nodes['node-1'].imageUrl, undefined);
  assert.equal(store.getState().nodes['node-1'].isGenerating, true);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'loading');
});

test('generationRecoveryV2 local proxy writes terminal resultSpec into async task cache', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading', generationStartTime: 100 },
  });
  const manager = createManager();
  const storage = createMemoryStorage();

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal image result must not schedule retry');
    },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        nodeId: 'node-1',
        provider: 'grsai',
        kind: 'image',
        status: 'success',
        result: {
          status: 'succeeded',
          results: [{ url: 'https://file5.aitohumanize.com/file/cache-final.png' }],
        },
        httpStatus: 200,
        contentType: 'application/json',
      }),
    }),
  });

  await session.flush();

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'runtime-grsai-1');
  assert.equal(records[0].clientTaskId, 'client-grsai-1');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].resultSpec.imageUrl, 'https://file5.aitohumanize.com/file/cache-final.png');
});

test('generationRecoveryV2 local proxy restores text completion result after refresh', async () => {
  const store = createStore({
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      isGenerating: true,
      jobStatus: 'running',
      generationStartTime: 100,
      asyncTaskStartedAt: 100,
      generationDuration: 7000,
      textTaskStatus: 'running',
      textTaskRecovering: true,
      data: {
        id: 'text-node-1',
        generationStartTime: 100,
        asyncTaskStartedAt: 100,
        generationDuration: 7000,
        textTaskStatus: 'running',
        textTaskRecovering: true,
      },
    },
  });
  const manager = createManager();
  const storage = createMemoryStorage();
  const requestedUrls = [];
  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 900,
    items: [{
      version: 1,
      runtimeTaskId: 'runtime-text-1',
      clientTaskId: 'client-text-1',
      kind: 'text',
      provider: 'custom_openai_compatible',
      modelId: 'custom_openai_compatible/gpt-5.4',
      nodeId: 'text-node-1',
      canvasId: 'canvas_1',
      status: 'polling',
      recoveryMode: 'local_proxy_poll',
      canResume: true,
      pollingSpec: {
        kind: 'generation',
        taskType: 'text-generation',
        provider: 'custom_openai_compatible',
        recoveryMode: 'local_proxy_poll',
        targetNodeId: 'text-node-1',
        runtimeTaskId: 'runtime-text-1',
        clientTaskId: 'client-text-1',
      },
      createdAt: 100,
      updatedAt: 900,
    }],
  }));

  const session = startGenerationRecoveryV2([createTextLocalProxyTask()], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal text result must not schedule retry');
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          runtimeTaskId: 'runtime-text-1',
          clientTaskId: 'client-text-1',
          nodeId: 'text-node-1',
          provider: 'custom_openai_compatible',
          kind: 'text',
          status: 'success',
          result: {
            id: 'resp_text_refresh_1',
            object: 'chat.completion',
            model: 'gpt-5.4',
            choices: [{ message: { role: 'assistant', content: '刷新后恢复文本' } }],
          },
          httpStatus: 200,
          contentType: 'application/json',
        }),
      };
    },
  });

  await session.flush();

  const node = store.getState().nodes['text-node-1'];
  const records = loadAsyncTaskRecords({ storage });
  assert.equal(requestedUrls[0], '/api/v2/proxy/local-task?runtimeTaskId=runtime-text-1&clientTaskId=client-text-1');
  assert.equal(node.id, 'text-node-1');
  assert.equal(node.nodeId, undefined);
  assert.equal(node.outputText, '刷新后恢复文本');
  assert.equal(node.isGenerating, false);
  assert.equal(node.asyncTaskStatus, 'success');
  assert.equal(node.generationStartTime, null);
  assert.equal(node.asyncTaskStartedAt, null);
  assert.equal(node.textTaskStatus, 'success');
  assert.equal(node.textTaskRecovering, false);
  assert.equal(node.data.generationStartTime, null);
  assert.equal(node.data.asyncTaskStartedAt, null);
  assert.equal(node.data.textTaskStatus, 'success');
  assert.equal(node.data.textTaskRecovering, false);
  assert.equal(node.generationDuration, 7000);
  assert.equal(node.data.generationDuration, 7000);
  assert.equal(manager.updates.at(-1).status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'runtime-text-1');
  assert.equal(records[0].clientTaskId, 'client-text-1');
  assert.equal(records[0].kind, 'text-generation');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteResultId, 'resp_text_refresh_1');
  assert.equal(records[0].resultSpec.outputText, '刷新后恢复文本');
});

test('generationRecoveryV2 text local proxy prefers recovery target over stale outer node id', async () => {
  const store = createStore({
    'stale-source-node': {
      id: 'stale-source-node',
      type: 'ai-text',
      outputText: '底层节点原文本',
      isGenerating: false,
      jobStatus: 'idle',
    },
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      isGenerating: true,
      jobStatus: 'running',
      generationStartTime: 100,
    },
  });
  const manager = createManager();
  const storage = createMemoryStorage();

  const session = startGenerationRecoveryV2([
    createTextLocalProxyTask({
      nodeId: 'stale-source-node',
      unifiedTask: { nodeId: 'stale-source-node' },
      recoverySpec: {
        targetNodeId: 'text-node-1',
        sourceNodeId: 'stale-source-node',
      },
    }),
  ], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('terminal text result must not schedule retry');
    },
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        runtimeTaskId: 'runtime-text-1',
        clientTaskId: 'client-text-1',
        nodeId: 'stale-source-node',
        provider: 'custom_openai_compatible',
        kind: 'text',
        status: 'success',
        result: {
          id: 'resp_text_target_identity_1',
          object: 'chat.completion',
          choices: [{ message: { role: 'assistant', content: '目标节点恢复文本' } }],
        },
      }),
    }),
  });

  await session.flush();

  const nodes = store.getState().nodes;
  const records = loadAsyncTaskRecords({ storage });
  assert.equal(nodes['text-node-1'].outputText, '目标节点恢复文本');
  assert.equal(nodes['text-node-1'].asyncTaskStatus, 'success');
  assert.equal(nodes['stale-source-node'].outputText, '底层节点原文本');
  assert.equal(nodes['stale-source-node'].jobStatus, 'idle');
  assert.equal(records.length, 1);
  assert.equal(records[0].nodeId, 'text-node-1');
  assert.equal(records[0].sourceNodeId, 'stale-source-node');
  assert.equal(records[0].resultSpec.outputText, '目标节点恢复文本');
});

test('generationRecoveryV2 text local proxy continues polling pending until success', async () => {
  const store = createStore({
    'text-node-1': { id: 'text-node-1', type: 'ai-text', isGenerating: true, jobStatus: 'running', generationStartTime: 100 },
  });
  const manager = createManager();
  const storage = createMemoryStorage();
  const scheduled = [];
  const requestedUrls = [];
  const responses = [
    { status: 'running', pending: true, message: 'still running' },
    {
      status: 'success',
      result: {
        id: 'resp_text_retry_1',
        object: 'chat.completion',
        model: 'gpt-5.4',
        choices: [{ message: { role: 'assistant', content: '第二轮恢复文本' } }],
      },
    },
  ];

  const session = startGenerationRecoveryV2([createTextLocalProxyTask()], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      const payload = responses.shift();
      return { ok: true, json: async () => payload };
    },
  });

  await session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 2000);
  assert.equal(requestedUrls[0], '/api/v2/proxy/local-task?runtimeTaskId=runtime-text-1&clientTaskId=client-text-1');

  await scheduled.shift().fn();
  await session.flush();

  const node = store.getState().nodes['text-node-1'];
  const records = loadAsyncTaskRecords({ storage });
  assert.equal(requestedUrls.length, 2);
  assert.equal(scheduled.length, 0);
  assert.equal(node.outputText, '第二轮恢复文本');
  assert.equal(node.isGenerating, false);
  assert.equal(node.asyncTaskStatus, 'success');
  assert.equal(manager.updates.at(-1).status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].resultSpec.outputText, '第二轮恢复文本');
});

test('generationRecoveryV2 text local proxy keeps polling explicit running beyond grace window', async () => {
  const store = createStore({
    'text-node-1': { id: 'text-node-1', type: 'ai-text', isGenerating: true, jobStatus: 'running', generationStartTime: 100 },
  });
  const manager = createManager();
  const storage = createMemoryStorage();
  const scheduled = [];
  const requestedUrls = [];
  let currentNow = 1000;
  const responses = [
    { status: 'running', message: 'still running after restore grace' },
    {
      status: 'success',
      result: {
        id: 'resp_text_long_running_1',
        object: 'chat.completion',
        model: 'gpt-5.4',
        choices: [{ message: { role: 'assistant', content: '超时后继续恢复文本' } }],
      },
    },
  ];

  const session = startGenerationRecoveryV2([createTextLocalProxyTask()], manager, {
    store,
    asyncTaskStorage: storage,
    now: () => currentNow,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      const payload = responses.shift();
      return { ok: true, json: async () => payload };
    },
  });

  currentNow = 70000;
  await session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(store.getState().nodes['text-node-1'].asyncTaskStatus, 'pending');

  currentNow = 72000;
  await scheduled.shift().fn();
  await session.flush();

  const node = store.getState().nodes['text-node-1'];
  const records = loadAsyncTaskRecords({ storage });
  assert.equal(requestedUrls.length, 2);
  assert.equal(node.outputText, '超时后继续恢复文本');
  assert.equal(node.asyncTaskStatus, 'success');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].resultSpec.outputText, '超时后继续恢复文本');
});

test('generationRecoveryV2 text local proxy transient missing response retries within grace window', async () => {
  const store = createStore({
    'text-node-1': { id: 'text-node-1', type: 'ai-text', isGenerating: true, jobStatus: 'running', generationStartTime: 100 },
  });
  const manager = createManager();
  const scheduled = [];
  const requestedUrls = [];
  const responses = [
    { status: 'missing', reason: 'request_lost' },
    {
      status: 'success',
      result: {
        id: 'resp_text_missing_retry_1',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: 'missing 后恢复文本' } }],
      },
    },
  ];

  const session = startGenerationRecoveryV2([createTextLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      const payload = responses.shift();
      return { ok: true, json: async () => payload };
    },
  });

  await session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 2000);

  await scheduled.shift().fn();
  await session.flush();

  assert.equal(requestedUrls.length, 2);
  assert.equal(store.getState().nodes['text-node-1'].outputText, 'missing 后恢复文本');
  assert.equal(manager.updates.at(-1).status, 'success');
});

test('generationRecoveryV2 remote poll continues polling pending until success', async () => {
  const store = createStore({
    'node-2': { id: 'node-2', isGenerating: true, jobStatus: 'loading' },
  });
  const manager = createManager();
  const scheduled = [];
  const requestedUrls = [];
  const responses = [
    { status: 'running', pending: true },
    { status: 'success', result: { imageUrl: '/output/remote-v2.png' } },
  ];

  const session = startGenerationRecoveryV2([createRemotePollTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async (url) => {
      requestedUrls.push(String(url));
      const payload = responses.shift();
      return { ok: true, json: async () => payload };
    },
  });

  await session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].ms, 2000);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/task?'));
  assert.ok(requestedUrls[0].includes('apiUrl='));
  assert.ok(decodeURIComponent(requestedUrls[0]).includes('https://provider.example/tasks/poll-1/status'));

  await scheduled.shift().fn();
  await session.flush();

  assert.equal(requestedUrls.length, 2);
  assert.equal(scheduled.length, 0);
  assert.equal(store.getState().nodes['node-2'].imageUrl, '/output/remote-v2.png');
  assert.equal(store.getState().nodes['node-2'].isGenerating, false);
  assert.equal(store.getState().nodes['node-2'].asyncTaskStatus, 'success');
  assert.equal(manager.updates.at(-1).status, 'success');
});

test('generationRecoveryV2 marks failed response terminal without retry', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' },
  });
  const manager = createManager();
  const scheduled = [];

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout(fn, ms) {
      scheduled.push({ fn, ms });
      return scheduled.length;
    },
    clearTimeout() {},
    fetch: async () => ({ ok: true, json: async () => ({ status: 'failed', error: 'provider failed' }) }),
  });

  await session.flush();

  assert.equal(scheduled.length, 0);
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'failed');
  assert.equal(manager.updates.at(-1).status, 'failed');
  assert.equal(manager.updates.at(-1).error, 'provider failed');
});

test('generationRecoveryV2 marks task interrupted after grace timeout without polling provider', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' },
  });
  const manager = createManager();
  let fetchCount = 0;

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 62001,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      throw new Error('timeout path must not schedule retry');
    },
    clearTimeout() {},
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ status: 'running', pending: true }) };
    },
  });

  await session.flush();

  assert.equal(fetchCount, 0);
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'interrupted');
  assert.equal(manager.updates.at(-1).status, 'interrupted');
});

test('generationRecoveryV2 waits when target node is not loaded yet', async () => {
  const store = createStrictSubscribableStore({});
  const manager = createManager();
  let fetchCount = 0;

  const session = startGenerationRecoveryV2([createLocalProxyTask()], manager, {
    store,
    now: () => 1000,
    pollIntervalMs: 2000,
    graceMs: 60000,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    fetch: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ status: 'running', pending: true }) };
    },
  });

  await session.flush();

  assert.equal(fetchCount, 0);
  assert.equal(manager.updates.length, 0);

  store.addNode({ id: 'node-1' });
  await session.flush();

  assert.equal(fetchCount, 1);
  assert.equal(store.getState().nodes['node-1'].isGenerating, true);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'loading');
  assert.equal(store.getState().nodes['node-1'].asyncTaskRecovering, true);
  assert.equal(store.getState().nodes['node-1'].asyncTaskStatus, 'pending');
});