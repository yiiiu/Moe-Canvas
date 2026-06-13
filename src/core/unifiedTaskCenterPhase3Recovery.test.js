import test from 'node:test';
import assert from 'node:assert/strict';

import { coordinateRestoredGenerationRecovery, __test__ as coordinatorTest } from './unifiedTaskCenterGenerationRecoveryCoordinator.js';
import { __test__ as recoveryTest, buildRestoredGenerationSpec, reconcileRestoredGenerationActiveTasks } from './unifiedTaskCenterGenerationRecovery.js';
import { resumeTask, submitTask } from './generationTaskRuntimeTaskCenterBridge.js';
import { buildGenerationNodeStateProjection } from './generationTaskNodeStateProjection.js';
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

function createLocalProxyRecoveryTask(overrides = {}) {
  const recoverySpec = {
    kind: 'generation',
    taskType: 'image-generation',
    provider: 'grsai',
    recoveryMode: 'local_proxy_poll',
    adapterType: 'modelApi',
    modelId: 'grsai/image-model',
    targetNodeId: 'node-1',
    taskId: 'runtime-grsai-1',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    pollingTaskId: '',
    queryableTaskId: '',
    payload: {
      provider: 'grsai',
      model: 'grsai/image-model',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
    },
    ...overrides.recoverySpec,
  };
  return {
    taskId: 'generation:node-1:runtime-grsai-1',
    nodeId: 'node-1',
    status: 'processing',
    kind: 'imageGeneration',
    provider: 'grsai',
    recoveryMode: 'local_proxy_poll',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    startedAt: 100,
    createdAt: 100,
    updatedAt: 100,
    recoverySpec,
    unifiedTask: {
      id: 'generation:node-1:runtime-grsai-1',
      kind: 'image',
      status: 'running',
      nodeId: 'node-1',
      provider: 'grsai',
      recoveryMode: 'local_proxy_poll',
      canCancel: false,
      canRetry: false,
      canResume: true,
      createdAt: 100,
      updatedAt: 100,
    },
    ...overrides.task,
  };
}

function localProxyJsonResponse(payload) {
  return { json: async () => payload };
}

test('node state projection builds local proxy running and terminal legacy patches from canonical task state', () => {
  const runningPatch = buildGenerationNodeStateProjection({
    phase: 'running',
    task: createLocalProxyRecoveryTask(),
  });
  const successPatch = buildGenerationNodeStateProjection({
    phase: 'terminal',
    task: createLocalProxyRecoveryTask({ task: { status: 'success' } }),
    resultPatch: {
      imageUrl: '/output/grsai-projected.png',
      localPath: 'output/grsai-projected.png',
    },
  });

  assert.equal(runningPatch.isGenerating, true);
  assert.equal(runningPatch.jobStatus, 'loading');
  assert.equal(runningPatch.asyncRuntimeTaskId, 'runtime-grsai-1');
  assert.equal(runningPatch.asyncClientTaskId, 'client-grsai-1');
  assert.equal(runningPatch.asyncTaskProvider, 'grsai');
  assert.equal(runningPatch.asyncTaskStatus, 'pending');
  assert.equal(runningPatch.asyncTaskRecovering, true);
  assert.equal(successPatch.imageUrl, '/output/grsai-projected.png');
  assert.equal(successPatch.localPath, 'output/grsai-projected.png');
  assert.equal(successPatch.isGenerating, false);
  assert.equal(successPatch.jobStatus, 'success');
  assert.equal(successPatch.generationStartTime, null);
  assert.equal(successPatch.asyncTaskStatus, 'success');
  assert.equal(successPatch.asyncTaskRecovering, false);
  assert.equal(successPatch.rhTaskRecovering, false);
  assert.equal(successPatch.dreaminaTaskRecovering, false);
});

test('migration normalizes legacy GRSAI remote-poll task into local proxy identity', () => {
  const legacyTask = createLocalProxyRecoveryTask({
    task: {
      taskId: 'generation:node-1:legacy-remote-poll',
      recoveryMode: 'remote_poll',
    },
    recoverySpec: {
      recoveryMode: 'remote_poll',
      taskId: 'async:image:grsai:node-1:runtime-grsai-1',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      queryableTaskId: 'async:image:grsai:node-1:runtime-grsai-1',
      pollingTaskId: 'async:image:grsai:node-1:runtime-grsai-1',
      taskMeta: {
        taskPolling: {
          urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
        },
      },
      payload: {
        provider: 'grsai',
        model: 'grsai/image-model',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
        taskPolling: {
          urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
        },
      },
    },
  });

  const normalized = coordinatorTest.normalizeRecoveryTaskIdentity(legacyTask);

  assert.equal(normalized.recoveryMode, 'local_proxy_poll');
  assert.equal(normalized.recoverySpec.recoveryMode, 'local_proxy_poll');
  assert.equal(normalized.recoverySpec.taskId, 'runtime-grsai-1');
  assert.equal(normalized.recoverySpec.runtimeTaskId, 'runtime-grsai-1');
  assert.equal(normalized.recoverySpec.clientTaskId, 'client-grsai-1');
  assert.equal(normalized.recoverySpec.queryableTaskId, '');
  assert.equal(normalized.recoverySpec.pollingTaskId, '');
  assert.equal(normalized.recoverySpec.taskMeta.taskPolling, undefined);
  assert.equal(normalized.recoverySpec.payload.taskPolling, undefined);
  assert.equal(coordinatorTest.getCanonicalRecoveryTaskKey(normalized), 'node-1:local:runtime-grsai-1');
});

test('migration recovery source merges legacy snapshot async record and node residue by canonical local identity', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      remoteTaskId: 'grsai-result-id',
      remoteResultId: 'grsai-result-id',
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
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
      },
    }]),
  });
  const store = createStore({
    'node-1': {
      id: 'node-1',
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 100,
      asyncRuntimeTaskId: 'runtime-grsai-1',
      asyncClientTaskId: 'client-grsai-1',
      asyncTaskId: 'async:image:grsai:node-1:runtime-grsai-1',
      asyncTaskProvider: 'grsai',
      asyncTaskKind: 'image',
      asyncTaskStatus: 'running',
      taskProvider: 'grsai',
      taskModelId: 'grsai/image-model',
      taskAdapterType: 'modelApi',
    },
  });
  const legacySnapshotTask = createLocalProxyRecoveryTask({
    task: {
      taskId: 'generation:node-1:legacy-remote-poll',
      status: 'processing',
      recoveryMode: 'remote_poll',
    },
    recoverySpec: {
      recoveryMode: 'remote_poll',
      taskId: 'async:image:grsai:node-1:runtime-grsai-1',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      queryableTaskId: 'async:image:grsai:node-1:runtime-grsai-1',
      pollingTaskId: 'async:image:grsai:node-1:runtime-grsai-1',
      taskMeta: {
        taskPolling: {
          urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
          method: 'GET',
        },
      },
      payload: {
        provider: 'grsai',
        model: 'grsai/image-model',
        runtimeTaskId: 'runtime-grsai-1',
        clientTaskId: 'client-grsai-1',
      },
    },
  });

  const tasks = coordinatorTest.collectRecoveryTasks([legacySnapshotTask], store, { storage });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].nodeId, 'node-1');
  assert.equal(tasks[0].recoverySpec.recoveryMode, 'local_proxy_poll');
  assert.equal(tasks[0].recoverySpec.runtimeTaskId, 'runtime-grsai-1');
  assert.equal(tasks[0].recoverySpec.clientTaskId, 'client-grsai-1');
  assert.equal(tasks[0].recoverySpec.queryableTaskId, '');
  assert.equal(tasks[0].recoverySpec.pollingTaskId, '');
});

test('migration recovery source reads legacy GRSAI residue from nested node data', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      type: 'aigen-image',
      data: {
        isGenerating: true,
        jobStatus: 'loading',
        generationStartTime: 100,
        asyncRuntimeTaskId: 'runtime-grsai-1',
        asyncClientTaskId: 'client-grsai-1',
        asyncTaskProvider: 'grsai',
        asyncTaskKind: 'image',
        asyncTaskStatus: 'running',
        taskProvider: 'grsai',
        taskModelId: 'grsai/image-model',
        taskAdapterType: 'modelApi',
      },
    },
  });

  const tasks = coordinatorTest.collectRecoveryTasks([], store, { storage: createMemoryStorage() });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].nodeId, 'node-1');
  assert.equal(tasks[0].recoverySpec.recoveryMode, 'local_proxy_poll');
  assert.equal(tasks[0].recoverySpec.runtimeTaskId, 'runtime-grsai-1');
  assert.equal(tasks[0].recoverySpec.clientTaskId, 'client-grsai-1');
});

test('phase3 remote poll recovery source accepts async record with queryable pollingTaskId', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:apimart:node-1:poll-1',
      pollingTaskId: 'poll-1',
      queryableTaskId: 'poll-1',
      kind: 'image',
      provider: 'apimart',
      modelId: 'apimart/image-model',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'apimart',
        targetNodeId: 'node-1',
        taskId: 'poll-1',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].recoverySpec.taskId, 'poll-1');
  assert.equal(tasks[0].recoverySpec.targetNodeId, 'node-1');
  assert.equal(tasks[0].recoverySpec.provider, 'apimart');
  assert.equal(tasks[0].recoverySpec.recoveryMode, 'remote_poll');
});

test('phase3 remote poll recovery source rejects active async record without queryable id', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:apimart:node-1:local-only',
      kind: 'image',
      provider: 'apimart',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'apimart',
        targetNodeId: 'node-1',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 0);
});

test('phase3 grsai local proxy recovery source accepts runtime/client credentials without queryable id', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      remoteTaskId: 'grsai-result-id',
      remoteResultId: 'grsai-result-id',
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

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].recoverySpec.taskId, 'runtime-grsai-1');
  assert.equal(tasks[0].recoverySpec.runtimeTaskId, 'runtime-grsai-1');
  assert.equal(tasks[0].recoverySpec.clientTaskId, 'client-grsai-1');
  assert.equal(tasks[0].recoverySpec.remoteTaskId, 'grsai-result-id');
  assert.equal(tasks[0].recoverySpec.pollingTaskId, '');
  assert.equal(tasks[0].recoverySpec.queryableTaskId, '');
  assert.equal(tasks[0].recoverySpec.recoveryMode, 'local_proxy_poll');
});

test('phase3 grsai local proxy recovery source rejects result-id derived runtime without client credential', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:node-1:15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
      clientTaskId: '',
      remoteTaskId: '15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
      remoteResultId: '15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
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
        runtimeTaskId: 'async:image:grsai:node-1:15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 0);
});

test('phase3 grsai local proxy recovery rebuilds missing client credential for submit-derived runtime id', () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'async:image:grsai:ai-image-1781347197665-gwlaweupx:1781347218060',
      clientTaskId: '',
      remoteTaskId: 'grsai-result-id',
      remoteResultId: 'grsai-result-id',
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
        runtimeTaskId: 'async:image:grsai:ai-image-1781347197665-gwlaweupx:1781347218060',
      },
    }]),
  });

  const tasks = coordinatorTest.collectAsyncTaskStoreRecoveryTasks({ storage });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].recoverySpec.runtimeTaskId, 'async:image:grsai:ai-image-1781347197665-gwlaweupx:1781347218060');
  assert.equal(tasks[0].recoverySpec.clientTaskId, 'client:async:image:grsai:ai-image-1781347197665-gwlaweupx:1781347218060');
  assert.equal(tasks[0].recoverySpec.recoveryMode, 'local_proxy_poll');
});

test('phase3 grsai node recovery uses local runtime id and strips remote polling ids', () => {
  const task = coordinatorTest.buildNodeRecoveryTask('node-1', {
    id: 'node-1',
    isGenerating: true,
    asyncTaskId: 'async:image:grsai:node-1:100',
    asyncTaskProvider: 'grsai',
    asyncTaskKind: 'image',
    asyncTaskStatus: 'running',
    asyncTaskStartedAt: 100,
    asyncClientTaskId: 'client:async:image:grsai:node-1:100',
    model: 'gpt-image-2',
  });

  assert.ok(task);
  assert.equal(task.recoverySpec.recoveryMode, 'local_proxy_poll');
  assert.equal(task.recoverySpec.taskId, 'async:image:grsai:node-1:100');
  assert.equal(task.recoverySpec.runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(task.recoverySpec.clientTaskId, 'client:async:image:grsai:node-1:100');
  assert.equal(task.recoverySpec.pollingTaskId, '');
  assert.equal(task.recoverySpec.queryableTaskId, '');

  const spec = buildRestoredGenerationSpec(task);
  const requestedUrls = [];
  assert.equal(spec.recoveryMode, 'local_proxy_poll');
  assert.equal(spec.taskId, 'async:image:grsai:node-1:100');
  assert.equal(spec.asyncTaskId, undefined);

  return spec.poll({
    localProxyTaskFetcher: async (url) => {
      requestedUrls.push(String(url));
      return localProxyJsonResponse({ status: 'running' });
    },
  }).then((result) => {
    assert.equal(result.pending, true);
    assert.equal(requestedUrls.length, 1);
    assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
    assert.ok(!requestedUrls[0].includes('/api/v2/proxy/task'));
    assert.ok(!requestedUrls[0].includes('/v1/api/result'));
  });
});

test('phase3 grsai node recovery rejects plain result id as local runtime id', () => {
  const task = coordinatorTest.buildNodeRecoveryTask('node-1', {
    id: 'node-1',
    isGenerating: true,
    asyncTaskId: '15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
    asyncTaskProvider: 'grsai',
    asyncTaskKind: 'image',
    asyncTaskStatus: 'running',
    asyncTaskStartedAt: 100,
    model: 'gpt-image-2',
  });

  assert.equal(task, null);
});

test('phase3 restored remote poll spec only exposes resume poll path, not submit path', () => {
  const spec = buildRestoredGenerationSpec({
    nodeId: 'node-1',
    status: 'processing',
    kind: 'imageGeneration',
    recoverySpec: {
      kind: 'generation',
      taskType: 'image-generation',
      provider: 'apimart',
      recoveryMode: 'remote_poll',
      adapterType: 'modelApi',
      modelId: 'apimart/image-model',
      targetNodeId: 'node-1',
      taskId: 'poll-1',
      payload: { provider: 'apimart', model: 'apimart/image-model' },
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
  assert.equal(spec.recoveryPollingTrace.provider, 'apimart');
  assert.equal(spec.recoveryPollingTrace.pollingTaskId, 'poll-1');
  assert.equal(spec.recoveryPollingTrace.remoteTaskId, '');
  assert.equal(spec.recoveryPollingTrace.pollStrategy, 'image-generation:manifest-taskPolling');
  assert.equal(spec.recoveryPollingTrace.pollUrl, 'https://provider.example/v1/tasks/poll-1/status?refresh=1');
  assert.ok(spec.recoveryPollingTrace.resultPaths.includes('data.image_url'));
});

test('phase3 status refresh response is not accepted as final image result', () => {
  const trace = recoveryTest.buildRecoveryPollingTrace({
    provider: 'apimart',
    modelId: 'apimart/image-model',
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

test('phase4 success payload with only result id is not accepted as displayable result', () => {
  const trace = recoveryTest.buildRecoveryPollingTrace({
    provider: 'grsai',
    modelId: 'grsai/image-model',
    taskId: 'runtime-grsai-1',
  }, 'image-generation');

  assert.throws(() => recoveryTest.buildGuardedRestoredResultPatch('image-generation', {
    status: 'success',
    id: 'result-only-id',
    resultId: 'result-only-id',
    result: { id: 'result-only-id' },
  }, {}, trace, {}), /未返回可用结果/);
  assert.equal(trace.failureReason, 'terminal-status-without-result');
  assert.equal(trace.explicitResultHit, '');
});

test('phase4 text result content is accepted as displayable result', () => {
  const trace = recoveryTest.buildRecoveryPollingTrace({
    provider: 'apimart',
    modelId: 'apimart/text-model',
    taskId: 'poll-1',
  }, 'text');

  const patch = recoveryTest.buildGuardedRestoredResultPatch('text', {
    status: 'success',
    result: { text: '生成完成' },
  }, {}, trace, {});

  assert.equal(patch.text, '生成完成');
  assert.equal(patch.content, '生成完成');
  assert.equal(trace.explicitResultHit, 'text');
});

test('phase3 restored remote poll resume writes success terminal async record', async () => {
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
    provider: 'apimart',
    adapterType: 'modelApi',
    modelId: 'apimart/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'apimart', model: 'apimart/image-model' },
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
  assert.equal(records[0].queryableTaskId, 'poll-1');
  assert.equal(records[0].remoteTaskId, '');
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 restored remote poll resume writes failed terminal async record', async () => {
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
    provider: 'apimart',
    adapterType: 'modelApi',
    modelId: 'apimart/image-model',
    executionId: 'restore.image-generation',
    payload: { provider: 'apimart', model: 'apimart/image-model' },
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
  assert.equal(records[0].queryableTaskId, 'poll-1');
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
  assert.equal(records[0].remoteResultId, '6-cfe0d052-cfd4-4d73-8313-05c6b6aaa795');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
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
  assert.equal(records[0].remoteResultId, 'final-result-id');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
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
  assert.equal(records[0].runtimeTaskId, 'async:image:grsai:node-1:100');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].remoteTaskId, '11-4473acb2-b3ce-48cf-858c-89e0cad9603c');
  assert.equal(records[0].remoteResultId, '11-4473acb2-b3ce-48cf-858c-89e0cad9603c');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
  assert.equal(records[0].resultSpec.imageUrl, 'https://cdn.example/result.png');
  assert.equal(records[0].createdAt, 100);
  assert.equal(records[0].finishedAt, 500);
});

test('phase3 submit binds runtimeTaskId and clientTaskId before provider request', async () => {
  const storage = createMemoryStorage();
  const store = createStore({
    'node-1': { id: 'node-1', canvasId: 'canvas-1' },
  });
  let capturedPayload = null;

  await submitTask({
    sourceNodeId: 'node-1',
    targetNodeId: 'node-1',
    canvasId: 'canvas-1',
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
    submit: async (payload) => {
      capturedPayload = payload;
      return { id: 'final-result-id', imageUrl: 'https://cdn.example/result.png' };
    },
    resultBuilder: (submitResult) => submitResult,
  }, { store, storage, now: () => 100 });

  const records = loadAsyncTaskRecords({ storage, now: 100 });
  const node = store.getState().nodes['node-1'];
  assert.equal(records.length, 1);
  assert.equal(capturedPayload.runtimeTaskId, records[0].runtimeTaskId);
  assert.equal(capturedPayload.clientTaskId, records[0].clientTaskId);
  assert.equal(capturedPayload.nodeId, 'node-1');
  assert.equal(capturedPayload.canvasId, 'canvas-1');
  assert.equal(capturedPayload.provider, 'grsai');
  assert.equal(capturedPayload.kind, 'image');
  assert.equal(node.asyncRuntimeTaskId, records[0].runtimeTaskId);
  assert.equal(node.clientTaskId, records[0].clientTaskId);
  assert.equal(records[0].payload.runtimeTaskId, records[0].runtimeTaskId);
  assert.equal(records[0].payload.clientTaskId, records[0].clientTaskId);
  assert.equal(records[0].pollingSpec.runtimeTaskId, records[0].runtimeTaskId);
  assert.equal(records[0].pollingSpec.clientTaskId, records[0].clientTaskId);
});

test('phase3 grsai legacy remote poll snapshot is forced to local proxy recovery', async () => {
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      recoveryMode: 'remote_poll',
      taskId: 'async:image:grsai:node-1:runtime-legacy',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      taskPolling: {
        urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
        method: 'GET',
      },
      recoveryCapability: {
        provider: 'grsai',
        recoveryMode: 'remote_poll',
        supportsRemotePoll: true,
        supportsLocalProxyRecovery: false,
        requiresQueryableTaskId: true,
      },
    },
    task: {
      recoveryMode: 'remote_poll',
    },
  });
  const spec = buildRestoredGenerationSpec(task);
  const requestedUrls = [];

  assert.equal(spec.recoveryMode, 'local_proxy_poll');
  assert.equal(spec.taskId, 'runtime-grsai-1');
  assert.equal(spec.recoveryPollingTrace.pollStrategy, 'image-generation:provider-resume');
  assert.equal(spec.recoveryPollingTrace.pollUrlTemplate, '');
  assert.equal(spec.recoveryPollingTrace.pollUrl, '');

  const result = await spec.poll({
    localProxyTaskFetcher: async (url) => {
      requestedUrls.push(String(url));
      return localProxyJsonResponse({ status: 'running' });
    },
  });

  assert.equal(result.pending, true);
  assert.equal(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
  assert.ok(!requestedUrls[0].includes('/api/v2/proxy/task'));
  assert.ok(!requestedUrls[0].includes('/v1/api/result'));
});

test('phase3 grsai legacy runtime taskId without local ids is not resumed as local proxy recovery', async () => {
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      recoveryMode: 'remote_poll',
      taskId: 'async:image:grsai:ai-image-1781182497407-tcgl5oaw8:1781182508723',
      runtimeTaskId: '',
      clientTaskId: '',
      taskPolling: {
        urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
        method: 'GET',
      },
      recoveryCapability: {
        provider: 'grsai',
        recoveryMode: 'remote_poll',
        supportsRemotePoll: true,
        supportsLocalProxyRecovery: false,
        requiresQueryableTaskId: true,
      },
      payload: {
        provider: 'grsai',
        model: 'grsai/image-model',
      },
    },
    task: {
      recoveryMode: 'remote_poll',
      runtimeTaskId: '',
      clientTaskId: '',
    },
  });
  const spec = buildRestoredGenerationSpec(task);

  assert.equal(spec, null);
});

test('phase3 grsai legacy local proxy pending state does not re-save remote taskPolling', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      recoveryMode: 'remote_poll',
      taskId: 'async:image:grsai:node-1:runtime-legacy',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      taskMeta: {
        taskPolling: {
          urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
          method: 'GET',
        },
      },
      payload: {
        provider: 'grsai',
        model: 'grsai/image-model',
        taskPolling: {
          urlTemplate: 'https://grsai.dakka.com.cn/v1/api/result?id={taskId}',
          method: 'GET',
        },
      },
      localProxyTaskFetcher: async () => localProxyJsonResponse({ status: 'missing', reason: 'request_lost' }),
      localProxyMissingGraceMs: 60_000,
      recoveryCapability: {
        provider: 'grsai',
        recoveryMode: 'remote_poll',
        supportsRemotePoll: true,
        supportsLocalProxyRecovery: false,
        requiresQueryableTaskId: true,
      },
    },
    task: {
      recoveryMode: 'remote_poll',
    },
  });
  let savedTask = null;
  const taskCenterManager = {
    upsertTask(taskInput) {
      savedTask = taskInput;
    },
  };

  const firstSpec = buildRestoredGenerationSpec(task);
  const pending = await resumeTask(firstSpec, {
    store,
    taskCenterManager,
    now: () => 1000,
  });

  assert.equal(pending.pending, true);
  assert.equal(savedTask.recoverySpec.recoveryMode, 'local_proxy_poll');
  assert.equal(savedTask.recoverySpec.taskMeta.taskPolling, undefined);
  assert.equal(savedTask.recoverySpec.payload.taskPolling, undefined);
  assert.equal(savedTask.recoverySpec.pollingTaskId, '');
  assert.equal(savedTask.recoverySpec.queryableTaskId, '');

  const nextSpec = buildRestoredGenerationSpec(savedTask);
  const requestedUrls = [];
  await nextSpec.poll({
    localProxyTaskFetcher: async (url) => {
      requestedUrls.push(String(url));
      return localProxyJsonResponse({ status: 'running' });
    },
  });

  assert.equal(nextSpec.recoveryMode, 'local_proxy_poll');
  assert.equal(nextSpec.taskMeta.taskPolling, undefined);
  assert.equal(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].startsWith('/api/v2/proxy/local-task?'));
  assert.ok(!requestedUrls[0].includes('/api/v2/proxy/task'));
  assert.ok(!requestedUrls[0].includes('/v1/api/result'));
});

test('phase3 coordinator resumes GRSAI local proxy task from interrupted async store record after refresh', async () => {
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      version: 1,
      runtimeTaskId,
      clientTaskId,
      remoteTaskId: '',
      remoteResultId: '',
      queryableTaskId: '',
      pollingTaskId: '',
      recoveryMode: 'local_proxy_poll',
      recoveryCapability: {
        provider: 'grsai',
        recoveryMode: 'local_proxy_poll',
        supportsRemotePoll: false,
        returnsImmediateResult: true,
        supportsLocalProxyRecovery: true,
        requiresQueryableTaskId: false,
      },
      kind: 'image',
      provider: 'grsai',
      modelId: 'gpt-image-2',
      nodeId: 'node-1',
      status: 'cancelled',
      error: '任务已取消',
      canCancel: false,
      canResume: false,
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'grsai',
        adapterType: 'modelApi',
        modelId: 'gpt-image-2',
        targetNodeId: 'node-1',
        runtimeTaskId,
        clientTaskId,
        resumable: true,
        cancellable: false,
        recoveryMode: 'local_proxy_poll',
      },
      payload: {
        provider: 'grsai',
        modelId: 'gpt-image-2',
        runtimeTaskId,
        clientTaskId,
        nodeId: 'node-1',
        canvasId: 'canvas_1',
      },
      createdAt: 1000,
      updatedAt: 1200,
      finishedAt: 1200,
    }]),
  });
  const store = createStore({
    'node-1': {
      id: 'node-1',
      type: 'aigen-image',
      data: {
        asyncRuntimeTaskId: runtimeTaskId,
        asyncClientTaskId: clientTaskId,
        asyncTaskProvider: 'grsai',
      },
    },
  });
  const fetchedUrls = [];

  const result = await new Promise((resolve) => {
    const session = coordinateRestoredGenerationRecovery([], {}, {
      store,
      storage,
      generationRecoveryRetryDelays: [0],
      generationRecoveryWatchMs: 200,
      resumeTaskFn: async (spec) => {
        const pollResult = await spec.poll({
          localProxyTaskFetcher: async (url, options) => {
            fetchedUrls.push({ url: String(url), options });
            return localProxyJsonResponse({ status: 'running', message: 'still running' });
          },
        });
        resolve({ session, spec, pollResult });
        return { ok: true, status: 'pending', pending: true };
      },
    });
    setTimeout(() => resolve({ session, spec: null, pollResult: null }), 80);
  });
  result.session.stop();

  assert.ok(result.spec, 'expected coordinator to resume async store task');
  assert.equal(result.spec.recoveryMode, 'local_proxy_poll');
  assert.equal(result.spec.runtimeTaskId, runtimeTaskId);
  assert.equal(result.spec.clientTaskId, clientTaskId);
  assert.equal(result.pollResult.pending, true);
  assert.equal(fetchedUrls.length, 1);
  assert.ok(fetchedUrls[0].url.startsWith('/api/v2/proxy/local-task?'));
  assert.ok(fetchedUrls[0].url.includes(`runtimeTaskId=${encodeURIComponent(runtimeTaskId)}`));
  assert.ok(fetchedUrls[0].url.includes(`clientTaskId=${encodeURIComponent(clientTaskId)}`));
});

test('phase3 coordinator resumes GRSAI local proxy task when restored store nodes are an array', async () => {
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId,
      clientTaskId,
      kind: 'image',
      provider: 'grsai',
      modelId: 'gpt-image-2',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
      recoveryMode: 'local_proxy_poll',
      pollingSpec: {
        kind: 'generation',
        taskType: 'image-generation',
        provider: 'grsai',
        targetNodeId: 'node-1',
        runtimeTaskId,
        clientTaskId,
        recoveryMode: 'local_proxy_poll',
      },
    }]),
  });
  const state = {
    nodes: [{
      id: 'node-1',
      type: 'aigen-image',
      data: {
        isGenerating: true,
        asyncRuntimeTaskId: runtimeTaskId,
        asyncClientTaskId: clientTaskId,
        asyncTaskProvider: 'grsai',
        asyncTaskStatus: 'running',
      },
    }],
  };
  const store = {
    getState() {
      return state;
    },
    updateNodeData(nodeId, patch) {
      const index = state.nodes.findIndex((node) => node.id === nodeId);
      if (index >= 0) state.nodes[index] = { ...state.nodes[index], data: { ...state.nodes[index].data, ...patch } };
    },
  };
  const fetchedUrls = [];

  const result = await new Promise((resolve) => {
    const session = coordinateRestoredGenerationRecovery([], {}, {
      store,
      storage,
      generationRecoveryRetryDelays: [0],
      generationRecoveryWatchMs: 200,
      resumeTaskFn: async (spec) => {
        const pollResult = await spec.poll({
          localProxyTaskFetcher: async (url) => {
            fetchedUrls.push(String(url));
            return localProxyJsonResponse({ status: 'running' });
          },
        });
        resolve({ session, spec, pollResult });
        return { ok: true, status: 'pending', pending: true };
      },
    });
    setTimeout(() => resolve({ session, spec: null, pollResult: null }), 80);
  });
  result.session.stop();

  assert.ok(result.spec, 'expected coordinator to find target node inside array store');
  assert.equal(result.spec.recoveryMode, 'local_proxy_poll');
  assert.equal(result.pollResult.pending, true);
  assert.equal(fetchedUrls.length, 1);
  assert.ok(fetchedUrls[0].startsWith('/api/v2/proxy/local-task?'));
});

test('phase3 grsai local proxy running response keeps restored task pending', async () => {
  const task = createLocalProxyRecoveryTask();
  const spec = buildRestoredGenerationSpec(task);
  const fetchedUrls = [];

  assert.equal(typeof spec.poll, 'function');
  assert.equal(spec.submit, undefined);
  assert.equal(spec.taskId, 'runtime-grsai-1');
  assert.equal(spec.recoveryPollingTrace.pollingTaskId, 'runtime-grsai-1');

  const result = await spec.poll({
    localProxyTaskFetcher: async (url, options) => {
      fetchedUrls.push({ url, options });
      return localProxyJsonResponse({ status: 'running', message: 'still running' });
    },
  });

  assert.equal(result.pending, true);
  assert.equal(result.status, 'running');
  assert.equal(result.message, 'still running');
  assert.equal(fetchedUrls.length, 1);
  assert.equal(fetchedUrls[0].options.method, 'GET');
  assert.ok(fetchedUrls[0].url.includes('/api/v2/proxy/local-task?'));
  assert.ok(fetchedUrls[0].url.includes('runtimeTaskId=runtime-grsai-1'));
  assert.ok(fetchedUrls[0].url.includes('clientTaskId=client-grsai-1'));
});

test('phase3 coordinator retries local proxy recovery after pending response', async () => {
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const task = createLocalProxyRecoveryTask();
  const manager = {};
  let resumeCount = 0;

  const session = coordinateRestoredGenerationRecovery([task], manager, {
    store,
    generationRecoveryRetryDelays: [0],
    generationRecoveryPollIntervalMs: 20,
    generationRecoveryWatchMs: 200,
    resumeRestoredTasks: async () => {
      resumeCount += 1;
      return [{ ok: true, status: 'pending', pending: true }];
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 650));
  session.stop();

  assert.ok(resumeCount >= 2);
});

test('phase3 grsai local proxy success response writes restored image result', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const task = createLocalProxyRecoveryTask();

  const result = await recoveryTest.buildRestoredGenerationSpec(task).poll({
    localProxyTaskFetcher: async () => localProxyJsonResponse({
      status: 'success',
      result: { imageUrl: 'https://cdn.example/local-proxy-result.png' },
    }),
  });
  const patch = recoveryTest.buildGuardedRestoredResultPatch('image-generation', result, { startedAt: 100 }, {}, {});

  assert.equal(patch.imageUrl, 'https://cdn.example/local-proxy-result.png');

  const resumed = await resumeTask({
    ...buildRestoredGenerationSpec(task),
    poll: async () => ({ imageUrl: 'https://cdn.example/local-proxy-result.png' }),
  }, { store, storage, now: () => 500 });
  const node = store.getState().nodes['node-1'];
  const records = loadAsyncTaskRecords({ storage, now: 500 });

  assert.equal(resumed.status, 'success');
  assert.equal(node.imageUrl, 'https://cdn.example/local-proxy-result.png');
  assert.equal(node.isGenerating, false);
  assert.equal(coordinatorTest.buildNodeRecoveryTask('node-1', node), null);
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'runtime-grsai-1');
  assert.equal(records[0].clientTaskId, 'client-grsai-1');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].resultSpec.imageUrl, 'https://cdn.example/local-proxy-result.png');
});

test('phase3 grsai restored active reconcile does not overwrite completed local proxy node with loading', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      type: 'aigen-image',
      imageUrl: '/output/grsai-local-result.png',
      images: [{ imageUrl: '/output/grsai-local-result.png' }],
      sourceUrl: '/output/grsai-local-result.png',
      localPath: 'output/grsai-local-result.png',
      isGenerating: false,
      jobStatus: 'success',
      generationStartTime: null,
      generationDuration: 400,
      asyncRuntimeTaskId: 'runtime-grsai-1',
      asyncClientTaskId: 'client-grsai-1',
      asyncTaskProvider: 'grsai',
      asyncTaskKind: 'image',
      asyncTaskStatus: 'success',
      asyncTaskRecovering: false,
    },
  });
  const task = createLocalProxyRecoveryTask();

  const reconciled = reconcileRestoredGenerationActiveTasks([task], { store });
  const node = store.getState().nodes['node-1'];

  assert.equal(reconciled.length, 0);
  assert.equal(node.imageUrl, '/output/grsai-local-result.png');
  assert.equal(node.isGenerating, false);
  assert.equal(node.jobStatus, 'success');
  assert.equal(node.generationStartTime, null);
  assert.equal(node.asyncTaskStatus, 'success');
});

test('phase3 grsai local proxy success unwraps cached response body before restoring image result', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
    }]),
  });
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      localProxyTaskFetcher: async () => localProxyJsonResponse({
        status: 'success',
        result: {
          status: 'success',
          response: {
            body: {
              imageUrl: 'https://cdn.example/local-proxy-response-body.png',
            },
          },
        },
      }),
    },
  });

  const resumed = await resumeTask(buildRestoredGenerationSpec(task), {
    store,
    storage,
    now: () => 500,
  });
  const node = store.getState().nodes['node-1'];
  const records = loadAsyncTaskRecords({ storage, now: 500 });

  assert.equal(resumed.status, 'success');
  assert.equal(node.imageUrl, 'https://cdn.example/local-proxy-response-body.png');
  assert.equal(node.isGenerating, false);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'success');
  assert.ok(records[0].resultSpec);
  assert.equal(records[0].resultSpec.imageUrl, 'https://cdn.example/local-proxy-response-body.png');
});

test('phase3 grsai local proxy success accepts results array url', async () => {
  const task = createLocalProxyRecoveryTask();

  const result = await recoveryTest.buildRestoredGenerationSpec(task).poll({
    localProxyTaskFetcher: async () => localProxyJsonResponse({
      status: 'success',
      result: { status: 'succeeded', results: [{ url: 'https://cdn.example/grsai-results-url.png' }] },
    }),
  });
  const patch = recoveryTest.buildGuardedRestoredResultPatch('image-generation', result, { startedAt: 100 }, {}, {});

  assert.equal(patch.imageUrl, 'https://cdn.example/grsai-results-url.png');
});

test('phase3 grsai local proxy success accepts cached response body data array url', async () => {
  const task = createLocalProxyRecoveryTask();

  const result = await recoveryTest.buildRestoredGenerationSpec(task).poll({
    localProxyTaskFetcher: async () => localProxyJsonResponse({
      status: 'success',
      result: {
        status: 'success',
        response: {
          body: {
            data: [{ url: 'https://cdn.example/local-proxy-body-data-array.png' }],
          },
        },
      },
    }),
  });
  const patch = recoveryTest.buildGuardedRestoredResultPatch('image-generation', result, { startedAt: 100 }, {}, {});

  assert.equal(patch.imageUrl, 'https://cdn.example/local-proxy-body-data-array.png');
});

test('phase3 grsai local proxy success accepts cached response body json string', async () => {
  const task = createLocalProxyRecoveryTask();

  const result = await recoveryTest.buildRestoredGenerationSpec(task).poll({
    localProxyTaskFetcher: async () => localProxyJsonResponse({
      status: 'success',
      result: {
        status: 'success',
        response: {
          body: JSON.stringify({
            data: [{ url: 'output/grsai-json-body-result.png' }],
          }),
        },
      },
    }),
  });
  const patch = recoveryTest.buildGuardedRestoredResultPatch('image-generation', result, { startedAt: 100 }, {}, {});

  assert.equal(patch.imageUrl, '/output/grsai-json-body-result.png');
  assert.equal(patch.localPath, 'output/grsai-json-body-result.png');
});

test('phase3 grsai local proxy success normalizes local image path and stops runtime timer', async () => {
  const storage = createMemoryStorage({
    'ai-canvas:async-tasks:v1': asyncTaskSnapshot([{
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      status: 'polling',
      canResume: true,
    }]),
  });
  const store = createStore({
    'node-1': {
      id: 'node-1',
      type: 'aigen-image',
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 100,
      generationDuration: null,
      asyncTaskStatus: 'running',
    },
  });
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      localProxyTaskFetcher: async () => localProxyJsonResponse({
        status: 'success',
        result: {
          status: 'success',
          response: {
            body: {
              data: [{ url: 'output/grsai-local-result.png' }],
            },
          },
        },
      }),
    },
  });

  const resumed = await resumeTask(buildRestoredGenerationSpec(task), {
    store,
    storage,
    now: () => 500,
  });
  const node = store.getState().nodes['node-1'];

  assert.equal(resumed.status, 'success');
  assert.equal(node.imageUrl, '/output/grsai-local-result.png');
  assert.equal(node.images[0].imageUrl, '/output/grsai-local-result.png');
  assert.equal(node.sourceUrl, '/output/grsai-local-result.png');
  assert.equal(node.localPath, 'output/grsai-local-result.png');
  assert.equal(node.isGenerating, false);
  assert.equal(node.jobStatus, 'success');
  assert.equal(node.generationStartTime, null);
  assert.notEqual(node.generationDuration, null);
  assert.equal(node.asyncTaskStatus, 'success');
  assert.equal(node.asyncTaskRecovering, false);
});

test('phase3 grsai local proxy transient missing response keeps restored task pending', async () => {
  const storage = createMemoryStorage();
  const now = Date.now();
  const store = createStore({
    'node-1': { id: 'node-1', isGenerating: true, asyncTaskStatus: 'running' },
  });
  const task = createLocalProxyRecoveryTask({
    task: {
      startedAt: now - 100,
      createdAt: now - 100,
      updatedAt: now - 100,
    },
    recoverySpec: {
      startedAt: now - 100,
      localProxyMissingGraceMs: 60_000,
      localProxyTaskFetcher: async () => localProxyJsonResponse({ status: 'missing', reason: 'request_lost' }),
    },
  });
  const result = await resumeTask(buildRestoredGenerationSpec(task), {
    store,
    storage,
    now: () => now,
  });
  const node = store.getState().nodes['node-1'];

  assert.notEqual(result.status, 'interrupted');
  assert.equal(node.isGenerating, true);
  assert.notEqual(node.asyncTaskStatus, 'interrupted');
});

test('phase3 grsai local proxy missing response is interrupted after grace window', async () => {
  const now = Date.now();
  const task = createLocalProxyRecoveryTask({
    recoverySpec: {
      localProxyMissingGraceMs: 60_000,
      localProxyTaskFetcher: async () => localProxyJsonResponse({ status: 'missing', reason: 'request_lost' }),
    },
  });
  const spec = buildRestoredGenerationSpec(task);

  const pending = await spec.poll({ now });
  assert.equal(pending.pending, true);
  assert.equal(pending.status, 'running');

  await assert.rejects(
    spec.poll({ now: now + 60_001 }),
    /request_lost/,
  );
});

test('phase3 grsai local proxy failed response is not accepted as final result', async () => {
  const task = createLocalProxyRecoveryTask();
  const spec = buildRestoredGenerationSpec(task);

  await assert.rejects(
    spec.poll({
      localProxyTaskFetcher: async () => localProxyJsonResponse({ status: 'failed', error: 'provider failed' }),
    }),
    /provider failed/,
  );
});
