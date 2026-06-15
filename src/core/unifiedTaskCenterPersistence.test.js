import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadTaskCenterSnapshot,
  persistTaskCenterSnapshot,
  restoreTaskCenterPersistence,
  serializeTaskCenterSnapshot,
} from './unifiedTaskCenterPersistence.js';
import { loadAsyncTaskRecords } from './asyncTaskStore.js';

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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

function generationTask(overrides = {}) {
  const recoverySpec = {
    kind: 'generation',
    taskType: 'image-generation',
    provider: 'apimart',
    recoveryMode: 'remote_poll',
    adapterType: 'modelApi',
    modelId: 'model-1',
    targetNodeId: 'node-1',
    taskId: 'poll-1',
    queryableTaskId: 'poll-1',
    pollingTaskId: 'poll-1',
    startedAt: 100,
    payload: {
      provider: 'apimart',
      model: 'model-1',
    },
    ...overrides.recoverySpec,
  };
  return {
    taskId: overrides.taskId || 'generation:node-1:poll-1',
    nodeId: 'node-1',
    kind: 'imageGeneration',
    status: 'processing',
    provider: recoverySpec.provider,
    model: recoverySpec.modelId,
    modelId: recoverySpec.modelId,
    createdAt: 100,
    startedAt: 100,
    updatedAt: 200,
    recoverySpec,
    unifiedTask: {
      id: overrides.taskId || 'generation:node-1:poll-1',
      kind: 'image',
      status: 'running',
      nodeId: 'node-1',
      provider: recoverySpec.provider,
      model: recoverySpec.modelId,
      canCancel: false,
      canRetry: false,
      canResume: true,
      createdAt: 100,
      updatedAt: 200,
    },
    ...overrides.task,
  };
}

test('unifiedTaskCenterPersistence: GRSAI result id is kept as metadata, not polling identity', () => {
  const snapshot = serializeTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        remoteTaskId: 'grsai-result-id',
        remoteResultId: 'grsai-result-id',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
    }),
  ], { now: 300 });

  assert.equal(snapshot.items.length, 1);
  const spec = snapshot.items[0].recoverySpec;
  assert.equal(spec.recoveryMode, 'local_proxy_poll');
  assert.equal(spec.taskId, 'runtime-grsai-1');
  assert.equal(spec.runtimeTaskId, 'runtime-grsai-1');
  assert.equal(spec.clientTaskId, 'client-grsai-1');
  assert.equal(spec.remoteTaskId, 'grsai-result-id');
  assert.equal(spec.remoteResultId, 'grsai-result-id');
  assert.equal(spec.pollingTaskId, '');
  assert.equal(spec.queryableTaskId, '');
});

test('unifiedTaskCenterPersistence: GRSAI snapshot with only result id is not resumable', () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({
      version: 1,
      savedAt: 300,
      items: [generationTask({
        taskId: 'generation:node-1:grsai-result-id',
        recoverySpec: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          modelId: 'grsai-model',
          targetNodeId: 'node-1',
          taskId: 'grsai-result-id',
          remoteTaskId: 'grsai-result-id',
          remoteResultId: 'grsai-result-id',
          payload: { provider: 'grsai', model: 'grsai-model' },
        },
      })],
    }),
  });

  const tasks = loadTaskCenterSnapshot({ storage, now: 500 });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].recoverySpec, null);
  assert.equal(tasks[0].unifiedTask.canResume, false);
});

test('unifiedTaskCenterPersistence: remote poll snapshot keeps queryable task id', () => {
  const snapshot = serializeTaskCenterSnapshot([
    generationTask({
      recoverySpec: {
        provider: 'apimart',
        recoveryMode: 'remote_poll',
        taskId: 'poll-apimart-1',
        queryableTaskId: 'poll-apimart-1',
        pollingTaskId: 'poll-apimart-1',
        remoteTaskId: 'final-result-id',
      },
    }),
  ], { now: 300 });

  const spec = snapshot.items[0].recoverySpec;
  assert.equal(spec.recoveryMode, 'remote_poll');
  assert.equal(spec.taskId, 'poll-apimart-1');
  assert.equal(spec.queryableTaskId, 'poll-apimart-1');
  assert.equal(spec.pollingTaskId, 'poll-apimart-1');
  assert.equal(spec.remoteTaskId, 'final-result-id');
});

test('unifiedTaskCenterPersistence: persisted local proxy snapshot mirrors runtime credentials to async records', () => {
  const storage = createMemoryStorage();
  const snapshot = persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
    }),
  ], { storage, now: 300 });

  const records = loadAsyncTaskRecords({ storage, now: 300 });

  assert.equal(snapshot.items.length, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'runtime-grsai-1');
  assert.equal(records[0].clientTaskId, 'client-grsai-1');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
});

test('unifiedTaskCenterPersistence: active local proxy snapshot does not mirror stale resultSpec to async records', () => {
  const storage = createMemoryStorage();
  persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
      task: {
        status: 'processing',
        result: { imageUrl: '/output/stale.png' },
      },
    }),
  ], { storage, now: 300 });

  const records = loadAsyncTaskRecords({ storage, now: 300 });

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'polling');
  assert.equal(records[0].runtimeTaskId, 'runtime-grsai-1');
  assert.equal(records[0].clientTaskId, 'client-grsai-1');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].resultSpec, null);
});

test('unifiedTaskCenterPersistence: terminal local proxy snapshot keeps resultSpec in async records', () => {
  const storage = createMemoryStorage();
  persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
      task: {
        status: 'success',
        result: { imageUrl: '/output/final.png' },
        finishedAt: 500,
        updatedAt: 500,
      },
    }),
  ], { storage, now: 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });

  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.deepEqual(records[0].resultSpec, { imageUrl: '/output/final.png' });
  assert.equal(records[0].finishedAt, 500);
});

test('unifiedTaskCenterPersistence: terminal local proxy snapshot closes stale async record', () => {
  const storage = createMemoryStorage();
  persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
    }),
  ], { storage, now: 300 });

  persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: {
          provider: 'grsai',
          model: 'grsai-model',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
        },
      },
      task: {
        status: 'failed',
        error: 'local proxy failed',
        finishedAt: 500,
        updatedAt: 500,
        unifiedTask: {
          id: 'generation:node-1:runtime-grsai-1',
          kind: 'image',
          status: 'failed',
          nodeId: 'node-1',
          provider: 'grsai',
          model: 'grsai-model',
          canCancel: false,
          canRetry: true,
          canResume: false,
          error: { message: 'local proxy failed' },
          createdAt: 100,
          updatedAt: 500,
        },
      },
    }),
  ], { storage, now: 500 });

  const records = loadAsyncTaskRecords({ storage, now: 500 });

  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'runtime-grsai-1');
  assert.equal(records[0].clientTaskId, 'client-grsai-1');
  assert.equal(records[0].status, 'failed');
  assert.equal(records[0].canResume, false);
  assert.equal(records[0].finishedAt, 500);
  assert.equal(records[0].error, 'local proxy failed');
});

test('unifiedTaskCenterPersistence: loading legacy local proxy snapshot writes sanitized idempotent snapshot', () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({
      version: 1,
      savedAt: 100,
      items: [generationTask({
        taskId: 'generation:node-1:runtime-grsai-1',
        recoverySpec: {
          provider: 'grsai',
          recoveryMode: 'remote_poll',
          modelId: 'grsai-model',
          targetNodeId: 'node-1',
          taskId: 'runtime-grsai-1',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
          queryableTaskId: 'runtime-grsai-1',
          pollingTaskId: 'runtime-grsai-1',
          taskMeta: {
            apiKey: 'secret-in-task-meta',
            headers: { Authorization: 'Bearer secret' },
            taskPolling: { urlTemplate: 'https://grsai.example/result?id={taskId}' },
            responseMapping: { resultPaths: ['data[].url'] },
          },
          payload: {
            provider: 'grsai',
            model: 'grsai-model',
            runtimeTaskId: 'runtime-grsai-1',
            clientTaskId: 'client-grsai-1',
            apiKey: 'secret-in-payload',
            body: { prompt: 'raw body must not persist' },
            taskPolling: { urlTemplate: 'https://grsai.example/result?id={taskId}' },
          },
        },
      })],
    }),
  });

  const firstLoad = loadTaskCenterSnapshot({ storage, now: 500 });
  const firstWritten = storage.getItem('ai-canvas:unified-task-center:snapshot:v1');
  const secondLoad = loadTaskCenterSnapshot({ storage, now: 500 });
  const secondWritten = storage.getItem('ai-canvas:unified-task-center:snapshot:v1');
  const written = JSON.parse(firstWritten);
  const spec = written.items[0].recoverySpec;

  assert.equal(firstLoad.length, 1);
  assert.equal(secondLoad.length, 1);
  assert.equal(firstWritten, secondWritten);
  assert.equal(spec.recoveryMode, 'local_proxy_poll');
  assert.equal(spec.taskId, 'runtime-grsai-1');
  assert.equal(spec.queryableTaskId, '');
  assert.equal(spec.pollingTaskId, '');
  assert.equal(spec.taskMeta.apiKey, undefined);
  assert.equal(spec.taskMeta.headers, undefined);
  assert.equal(spec.taskMeta.taskPolling, undefined);
  assert.equal(spec.payload.apiKey, undefined);
  assert.equal(spec.payload.body, undefined);
  assert.equal(spec.payload.taskPolling, undefined);
});

test('unifiedTaskCenterPersistence: V2 owns restored local proxy recovery and bypasses legacy resume', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({
      version: 1,
      savedAt: 100,
      items: [generationTask({
        taskId: 'generation:node-1:runtime-grsai-1',
        recoverySpec: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          modelId: 'grsai-model',
          targetNodeId: 'node-1',
          taskId: 'runtime-grsai-1',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
          queryableTaskId: '',
          pollingTaskId: '',
          payload: {
            provider: 'grsai',
            model: 'grsai-model',
            runtimeTaskId: 'runtime-grsai-1',
            clientTaskId: 'client-grsai-1',
          },
        },
      })],
    }),
  });
  const state = { nodes: { 'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' } } };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
  const manager = {
    upserts: [],
    upsertTask(task) {
      this.upserts.push(task);
      return task;
    },
  };
  const requestedUrls = [];
  let legacyResumeCount = 0;

  const restored = restoreTaskCenterPersistence(manager, {
    storage,
    store,
    now: () => 1000,
    generationRecoveryV2: true,
    generationRecoveryV2Options: {
      pollIntervalMs: 2000,
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return { ok: true, json: async () => ({ status: 'running', pending: true }) };
      },
      setTimeout: () => 1,
      clearTimeout() {},
    },
    resumeRestoredTasks: async () => {
      legacyResumeCount += 1;
      return [];
    },
  });

  const session = restored.generationRecoveryV2Session;
  assert.ok(session);
  await session.flush();

  assert.equal(restored.length, 1);
  assert.equal(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
  assert.equal(legacyResumeCount, 0);
});

test('unifiedTaskCenterPersistence: async-store text local proxy record starts V2 recovery when task snapshot is empty', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({ version: 1, savedAt: 100, items: [] }),
    'ai-canvas:async-tasks:v1': JSON.stringify({
      version: 1,
      savedAt: 100,
      items: [{
        runtimeTaskId: 'runtime-text-1',
        clientTaskId: 'client-text-1',
        kind: 'text',
        provider: 'openai-compatible',
        modelId: 'text-model',
        nodeId: 'text-node-1',
        status: 'polling',
        canResume: true,
        recoveryMode: 'local_proxy_poll',
        pollingSpec: {
          kind: 'generation',
          taskType: 'text',
          provider: 'openai-compatible',
          recoveryMode: 'local_proxy_poll',
          targetNodeId: 'text-node-1',
          taskId: 'runtime-text-1',
          runtimeTaskId: 'runtime-text-1',
          clientTaskId: 'client-text-1',
          payload: {
            provider: 'openai-compatible',
            model: 'text-model',
            runtimeTaskId: 'runtime-text-1',
            clientTaskId: 'client-text-1',
          },
        },
        payload: {
          provider: 'openai-compatible',
          model: 'text-model',
          runtimeTaskId: 'runtime-text-1',
          clientTaskId: 'client-text-1',
        },
        createdAt: 100,
        updatedAt: 200,
      }],
    }),
  });
  const state = { nodes: { 'text-node-1': { id: 'text-node-1', isGenerating: true, jobStatus: 'loading' } } };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
  const manager = {
    upserts: [],
    upsertTask(task) {
      this.upserts.push(task);
      return task;
    },
  };
  const requestedUrls = [];
  let legacyResumeCount = 0;

  const restored = restoreTaskCenterPersistence(manager, {
    storage,
    store,
    now: () => 1000,
    generationRecoveryV2: true,
    generationRecoveryV2Options: {
      pollIntervalMs: 2000,
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return { ok: true, json: async () => ({ status: 'running', pending: true }) };
      },
      setTimeout: () => 1,
      clearTimeout() {},
    },
    resumeRestoredTasks: async () => {
      legacyResumeCount += 1;
      return [];
    },
  });

  assert.ok(restored.generationRecoveryV2Session);
  await restored.generationRecoveryV2Session.flush();

  assert.equal(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
  assert.match(requestedUrls[0], /runtimeTaskId=runtime-text-1/);
  assert.match(requestedUrls[0], /clientTaskId=client-text-1/);
  assert.equal(legacyResumeCount, 0);
});

test('unifiedTaskCenterPersistence: restored V2 task center cards are marked as runtime projections', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({
      version: 1,
      savedAt: 100,
      items: [generationTask({
        taskId: 'generation:node-1:runtime-grsai-1',
        recoverySpec: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          modelId: 'grsai-model',
          targetNodeId: 'node-1',
          taskId: 'runtime-grsai-1',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
          queryableTaskId: '',
          pollingTaskId: '',
          payload: {
            provider: 'grsai',
            model: 'grsai-model',
            runtimeTaskId: 'runtime-grsai-1',
            clientTaskId: 'client-grsai-1',
          },
        },
      })],
    }),
  });
  const state = { nodes: { 'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' } } };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
  const manager = {
    upserts: [],
    upsertTask(task) {
      this.upserts.push(task);
      return task;
    },
  };

  const restored = restoreTaskCenterPersistence(manager, {
    storage,
    store,
    now: () => 1000,
    generationRecoveryV2: true,
    generationRecoveryV2Options: {
      pollIntervalMs: 2000,
      fetch: async () => ({ ok: true, json: async () => ({ status: 'running', pending: true }) }),
      setTimeout: () => 1,
      clearTimeout() {},
    },
    resumeRestoredTasks: async () => [],
  });
  await restored.generationRecoveryV2Session.flush();

  assert.equal(manager.upserts.length >= 1, true);
  assert.equal(manager.upserts[0].projectionSource, 'asyncTaskRuntime');
  assert.equal(manager.upserts[0].ownsRecoveryFact, false);
  assert.equal(manager.upserts.at(-1).projectionSource, 'asyncTaskRuntime');
  assert.equal(manager.upserts.at(-1).ownsRecoveryFact, false);
});

test('unifiedTaskCenterPersistence: V2 refresh recovery updates one task card without duplicates', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:unified-task-center:snapshot:v1': JSON.stringify({
      version: 1,
      savedAt: 100,
      items: [generationTask({
        taskId: 'generation:node-1:runtime-grsai-1',
        recoverySpec: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          modelId: 'grsai-model',
          targetNodeId: 'node-1',
          taskId: 'runtime-grsai-1',
          runtimeTaskId: 'runtime-grsai-1',
          clientTaskId: 'client-grsai-1',
          queryableTaskId: '',
          pollingTaskId: '',
          payload: { provider: 'grsai', runtimeTaskId: 'runtime-grsai-1', clientTaskId: 'client-grsai-1' },
        },
      })],
    }),
  });
  const state = { nodes: { 'node-1': { id: 'node-1', isGenerating: true, jobStatus: 'loading' } } };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
  const taskMap = new Map();
  const manager = {
    tasks: taskMap,
    upserts: [],
    upsertTask(task) {
      this.upserts.push(task);
      this.tasks.set(task.taskId, { ...(this.tasks.get(task.taskId) || {}), ...task });
      return task;
    },
  };

  const restored = restoreTaskCenterPersistence(manager, {
    storage,
    store,
    now: () => 1000,
    generationRecoveryV2: true,
    generationRecoveryV2Options: {
      pollIntervalMs: 2000,
      fetch: async () => ({
        ok: true,
        json: async () => ({
          status: 'success',
          result: { status: 'succeeded', results: [{ url: '/output/final.png' }] },
        }),
      }),
      setTimeout: () => 1,
      clearTimeout() {},
    },
    resumeRestoredTasks: async () => [],
  });
  await restored.generationRecoveryV2Session.flush();

  assert.equal(manager.tasks.size, 1);
  assert.equal([...manager.tasks.keys()][0], 'generation:node-1:runtime-grsai-1');
  assert.equal(manager.tasks.get('generation:node-1:runtime-grsai-1').status, 'success');
  assert.equal(manager.tasks.get('generation:node-1:runtime-grsai-1').projectionSource, 'asyncTaskRuntime');
});

test('unifiedTaskCenterPersistence: clearing terminal task center cards keeps active async recovery records', () => {
  const storage = createMemoryStorage();
  const asyncTaskStorage = createMemoryStorage();
  persistTaskCenterSnapshot([
    generationTask({
      taskId: 'generation:node-1:runtime-grsai-1',
      task: { status: 'complete', finishedAt: 1000 },
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        targetNodeId: 'node-1',
        taskId: 'runtime-grsai-1',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: { provider: 'grsai', runtimeTaskId: 'runtime-grsai-1', clientTaskId: 'client-grsai-1' },
      },
    }),
    generationTask({
      taskId: 'generation:node-2:runtime-grsai-2',
      task: { nodeId: 'node-2', status: 'processing' },
      recoverySpec: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        modelId: 'grsai-model',
        targetNodeId: 'node-2',
        taskId: 'runtime-grsai-2',
        runtimeTaskId: 'runtime-grsai-2',
        clientTaskId: 'client-grsai-2',
        queryableTaskId: '',
        pollingTaskId: '',
        payload: { provider: 'grsai', runtimeTaskId: 'runtime-grsai-2', clientTaskId: 'client-grsai-2' },
      },
    }),
  ], { storage, asyncTaskStorage, now: 1200 });

  persistTaskCenterSnapshot([], { storage, asyncTaskStorage, now: 1300 });

  const records = loadAsyncTaskRecords({ storage: asyncTaskStorage });
  assert.equal(records.some((record) => record.runtimeTaskId === 'runtime-grsai-2' && record.status === 'polling'), true);
});
