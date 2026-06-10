import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__ as coordinatorTest } from './unifiedTaskCenterGenerationRecoveryCoordinator.js';
import { __test__ as recoveryTest, buildRestoredGenerationSpec } from './unifiedTaskCenterGenerationRecovery.js';
import { resumeTask, submitTask } from './generationTaskRuntimeTaskCenterBridge.js';
import { loadAsyncTaskRecords } from './asyncTaskStore.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function asyncTaskSnapshot(items = []) {
  return JSON.stringify({ version: 1, savedAt: 1000, items });
}

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

test('phase3 recovery source accepts async record with pollingTaskId', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:poll-1',
      pollingTaskId: 'poll-1',
      kind: 'image',
      provider: 'grsai',
      modelId: 'grsai/image-model',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'grsai',
        targetNodeId: 'node-1',
        taskId: 'poll-1',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].recoverySpec.taskId, 'poll-1');
  assert.equal(tasks[0].recoverySpec.targetNodeId, 'node-1');
  assert.equal(tasks[0].recoverySpec.provider, 'grsai');
});

test('phase3 recovery source rejects active async record without pollingTaskId', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:local-only',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'grsai',
        targetNodeId: 'node-1',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 0);
});

test('phase3 restored spec only exposes resume poll path, not submit path', () => {
  const spec = buildRestoredGenerationSpec({
    nodeId: 'node-1',
    status: 'processing',
    kind: 'imageGeneration',
    recoverySpec: {
      kind: 'generation',
      taskType: 'image-generation',
      provider: 'grsai',
      adapterType: 'modelApi',
      modelId: 'grsai/image-model',
      targetNodeId: 'node-1',
      taskId: 'poll-1',
      payload: { provider: 'grsai', model: 'grsai/image-model' },
      taskMeta: {
        taskPolling: {
          urlTemplate: 'https://provider.example/v1/tasks/{taskId}/status?refresh=1',
          method: 'GET',
        },
        responseMapping: {
          resultPaths: ['data.image_url'],
        },
      },
    },
  });

  assert.equal(typeof spec.poll, 'function');
  assert.equal(spec.submit, undefined);
  assert.equal(spec.recoveryPollingTrace.provider, 'grsai');
  assert.equal(spec.recoveryPollingTrace.pollingTaskId, 'poll-1');
  assert.equal(spec.recoveryPollingTrace.remoteTaskId, '');
  assert.equal(spec.recoveryPollingTrace.pollStrategy, 'image-generation:manifest-taskPolling');
  assert.equal(spec.recoveryPollingTrace.pollUrl, 'https://provider.example/v1/tasks/poll-1/status?refresh=1');
  assert.ok(spec.recoveryPollingTrace.resultPaths.includes('data.image_url'));
});

test('phase3 status refresh response is not accepted as final image result', () => {
  const trace = recoveryTest.buildRecoveryPollingTrace({
    provider: 'grsai',
    modelId: 'grsai/image-model',
    taskId: 'poll-1',
    taskMeta: {
      taskPolling: {
        urlTemplate: 'https://provider.example/v1/tasks/{taskId}/status?refresh=1',
      },
      responseMapping: {
        resultPaths: ['data.image_url'],
      },
    },
  }, 'image-generation');

  assert.throws(() => recoveryTest.buildGuardedRestoredResultPatch('image-generation', {
    status: 'success',
    data: { status: 'success' },
  }, {}, trace, { resultPaths: ['data.image_url'] }), /未返回可用结果/);
  assert.equal(trace.statusValue, 'success');
  assert.equal(trace.resultPathHit, '');
  assert.equal(trace.failureReason, 'status-refresh-without-result');
});

test('phase3 mapped result path is accepted and traceable', () => {
  const trace = recoveryTest.buildRecoveryPollingTrace({
    provider: 'grsai',
    modelId: 'grsai/image-model',
    taskId: 'poll-1',
    taskMeta: {
      taskPolling: {
        urlTemplate: 'https://provider.example/v1/tasks/{taskId}/status?refresh=1',
      },
      responseMapping: {
        resultPaths: ['data.image_url'],
      },
    },
  }, 'image-generation');

  const patch = recoveryTest.buildGuardedRestoredResultPatch('image-generation', {
    status: 'success',
    data: { image_url: 'https://cdn.example/result.png' },
  }, {}, trace, { resultPaths: ['data.image_url'] });

  assert.equal(patch.imageUrl, 'https://cdn.example/result.png');
  assert.equal(trace.resultPathHit, 'data.image_url');
  assert.equal(trace.explicitResultHit, 'imageUrl');
  assert.equal(trace.failureReason, '');
});

test('phase3 restored resume writes success terminal async record', async () => {
  const storage = createMemoryStorage();
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskId: 'poll-1', pollingTaskId: 'poll-1', asyncTaskStatus: 'running' },
  });
  const result = await resumeTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'restore',
    taskId: 'poll-1',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    taskCenterVisibility: 'visible',
    poll: async () => ({ imageUrl: 'https://cdn.example/result.png' }),
    resultBuilder: (pollResult) => pollResult,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].pollingTaskId, 'poll-1');
  assert.equal(records[0].remoteTaskId, '');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 restored resume writes failed terminal async record', async () => {
  const storage = createMemoryStorage();
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskId: 'poll-1', pollingTaskId: 'poll-1', asyncTaskStatus: 'running' },
  });
  const result = await resumeTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'restore',
    taskId: 'poll-1',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    taskCenterVisibility: 'visible',
    poll: async () => { throw new Error('provider failed'); },
    resultBuilder: (pollResult) => pollResult,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'failed');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].pollingTaskId, 'poll-1');
  assert.equal(records[0].remoteTaskId, '');
  assert.equal(records[0].finishedAt, 500);
  assert.equal(records[0].error, 'provider failed');
});

test('phase3 grsai terminal failure result id is cached as remoteTaskId only', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:100',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: false,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const terminalPayload = {
    id: '6-cfe0d052-cfd4-4d73-8313-05c6b6aaa795',
    status: 'failed',
    error: 'excessive system load',
  };

  const result = await resumeTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'restore',
    taskId: 'poll-1',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    taskCenterVisibility: 'visible',
    poll: async () => terminalPayload,
    resultBuilder: (pollResult) => pollResult,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].remoteTaskId, '6-cfe0d052-cfd4-4d73-8313-05c6b6aaa795');
  assert.equal(records[0].pollingTaskId, 'poll-1');
  assert.equal(records[0].error, 'excessive system load');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 grsai terminal success result id is not promoted to pollingTaskId', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:100',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: false,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });

  const result = await resumeTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'restore',
    taskId: 'poll-1',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    taskCenterVisibility: 'visible',
    poll: async () => ({
      id: 'final-result-id',
      imageUrl: 'https://cdn.example/result.png',
    }),
    resultBuilder: (pollResult) => pollResult,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteTaskId, 'final-result-id');
  assert.equal(records[0].pollingTaskId, 'poll-1');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 grsai direct terminal submit keeps final id out of pollingTaskId', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:100',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: false,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });

  const result = await submitTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'generate',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'generate.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    async: true,
    taskCenterVisibility: 'visible',
    submit: async () => ({
      id: 'final-result-id',
      imageUrl: 'https://cdn.example/result.png',
    }),
    resultBuilder: (submitResult) => submitResult,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteTaskId, 'final-result-id');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 grsai direct terminal submit updates initial runtime cache record', async () => {
  const storage = createMemoryStorage();
  const store = createStore({
    'node-1': { id: 'node-1' },
  });

  const result = await submitTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'generate',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'generate.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    async: true,
    taskCenterVisibility: 'visible',
    submit: async () => ({
      taskId: '15-f63dd94f-9902-41e4-adf8-0b301389f540',
      result: { imageUrl: 'https://cdn.example/result.png' },
    }),
    resultBuilder: (submitResult) => submitResult.result,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  const node = store.getState().nodes['node-1'];
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, node.asyncRuntimeTaskId);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteTaskId, '15-f63dd94f-9902-41e4-adf8-0b301389f540');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 grsai direct terminal submit updates matching active runtime cache record', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:100',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: false,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });

  const result = await submitTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'generate',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    executionId: 'generate.image-generation',
    payload: { provider: 'grsai', model: 'grsai/image-model' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    async: true,
    taskCenterVisibility: 'visible',
    submit: async () => ({
      taskId: '15-f63dd94f-9902-41e4-adf8-0b301389f540',
      result: { imageUrl: 'https://cdn.example/result.png' },
    }),
    resultBuilder: (submitResult) => submitResult.result,
  }, { store, storage, now: () => 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteTaskId, '15-f63dd94f-9902-41e4-adf8-0b301389f540');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 grsai async submit response updates polling cache record instead of appending one', async () => {
  const storage = createMemoryStorage();
  const store = createStore({
    'node-1': { id: 'node-1' },
  });
  let now = 100;

  const result = await submitTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    trigger: 'generate',
    taskType: 'image-generation',
    provider: 'grsai',
    adapterType: 'modelApi',
    modelId: 'gpt-image-2',
    executionId: 'generate.image-generation',
    payload: { provider: 'grsai', model: 'gpt-image-2' },
    startedAt: 100,
    resumable: true,
    cancellable: false,
    async: true,
    taskCenterVisibility: 'visible',
    submit: async (_payload, runtimeOptions = {}) => {
      runtimeOptions.onTaskId?.('11-4473acb2-b3ce-48cf-858c-89e0cad9603c');
      now = 500;
      return {
        taskId: '11-4473acb2-b3ce-48cf-858c-89e0cad9603c',
        result: { imageUrl: 'https://cdn.example/result.png' },
      };
    },
    resultBuilder: (submitResult) => submitResult.result,
  }, { store, storage, now: () => now });

  const records = loadAsyncTaskRecords({ storage, now: 500 });
  assert.equal(result.status, 'success');
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:11-4473acb2-b3ce-48cf-858c-89e0cad9603c');
  assert.equal(records[0].pollingTaskId, '11-4473acb2-b3ce-48cf-858c-89e0cad9603c');
  assert.equal(records[0].remoteTaskId, '');
  assert.equal(records[0].resultSpec.imageUrl, 'https://cdn.example/result.png');
  assert.equal(records[0].createdAt, 100);
  assert.equal(records[0].finishedAt, 500);
});