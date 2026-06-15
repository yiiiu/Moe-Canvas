import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAsyncTaskRecords, upsertAsyncTaskRecord } from './asyncTaskStore.js';

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

test('asyncTaskStore: remote id response updates the startup placeholder record', () => {
  const storage = createMemoryStorage();
  const first = upsertAsyncTaskRecord({
    runtimeTaskId: 'async:provider_async:apimart:node-1:1000',
    kind: 'provider_async',
    provider: 'apimart',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'running',
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  const second = upsertAsyncTaskRecord({
    kind: 'image',
    provider: 'apimart',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    pollingTaskId: 'remote-task-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(second.runtimeTaskId, first.runtimeTaskId);
  assert.equal(records[0].runtimeTaskId, first.runtimeTaskId);
  assert.equal(records[0].kind, 'image');
  assert.equal(records[0].pollingTaskId, 'remote-task-1');
  assert.equal(records[0].status, 'polling');
});

test('asyncTaskStore: existing duplicate placeholder and remote records are compacted on load', () => {
  const storage = createMemoryStorage();
  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1200,
    items: [
      {
        version: 1,
        runtimeTaskId: 'async:image:apimart:node-1:remote-task-1',
        kind: 'image',
        provider: 'apimart',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        pollingTaskId: 'remote-task-1',
        status: 'polling',
        createdAt: 1000,
        updatedAt: 1200,
      },
      {
        version: 1,
        runtimeTaskId: 'async:provider_async:apimart:node-1:1000',
        kind: 'provider_async',
        provider: 'apimart',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  }));

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, 'async:provider_async:apimart:node-1:1000');
  assert.equal(records[0].kind, 'image');
  assert.equal(records[0].pollingTaskId, 'remote-task-1');
  assert.equal(records[0].createdAt, 1000);
});

test('asyncTaskStore: a new attempt on the same node is not collapsed after previous attempt has remote id', () => {
  const storage = createMemoryStorage();
  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:apimart:node-1:remote-task-1',
    kind: 'image',
    provider: 'apimart',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    pollingTaskId: 'remote-task-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:apimart:node-1:2000',
    kind: 'image',
    provider: 'apimart',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'running',
    createdAt: 2000,
    updatedAt: 2000,
  }, { storage, now: 2000 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.runtimeTaskId).sort(), [
    'async:image:apimart:node-1:2000',
    'async:image:apimart:node-1:remote-task-1',
  ]);
});

test('asyncTaskStore: active text local proxy record stays resumable for refresh recovery', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:text:custom:text-node-1:1000';
  const clientTaskId = `client:${runtimeTaskId}`;

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'text',
    provider: 'custom',
    modelId: 'gpt-5.4',
    nodeId: 'text-node-1',
    canvasId: 'canvas_1',
    status: 'polling',
    canCancel: false,
    canResume: true,
    recoveryMode: 'local_proxy_poll',
    recoveryCapability: {
      provider: 'custom',
      recoveryMode: 'local_proxy_poll',
      supportsRemotePoll: false,
      returnsImmediateResult: true,
      supportsLocalProxyRecovery: true,
      requiresQueryableTaskId: false,
    },
    pollingSpec: {
      kind: 'generation',
      taskType: 'text-generation',
      provider: 'custom',
      recoveryMode: 'local_proxy_poll',
      targetNodeId: 'text-node-1',
      runtimeTaskId,
      clientTaskId,
      startedAt: 1000,
      payload: {
        provider: 'custom',
        model: 'gpt-5.4',
        runtimeTaskId,
        clientTaskId,
        nodeId: 'text-node-1',
        canvasId: 'canvas_1',
        kind: 'text',
      },
    },
    payload: {
      provider: 'custom',
      model: 'gpt-5.4',
      runtimeTaskId,
      clientTaskId,
      nodeId: 'text-node-1',
      canvasId: 'canvas_1',
      kind: 'text',
    },
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  const [record] = loadAsyncTaskRecords({ storage, now: 1200 });
  assert.equal(record.runtimeTaskId, runtimeTaskId);
  assert.equal(record.clientTaskId, clientTaskId);
  assert.equal(record.kind, 'text');
  assert.equal(record.status, 'polling');
  assert.equal(record.recoveryMode, 'local_proxy_poll');
  assert.equal(record.canResume, true);
  assert.equal(record.pollingSpec.targetNodeId, 'text-node-1');
  assert.equal(record.pollingSpec.runtimeTaskId, runtimeTaskId);
  assert.equal(record.pollingSpec.clientTaskId, clientTaskId);
});

test('asyncTaskStore: text local proxy terminal write replaces existing polling record across kind aliases', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:text:custom_openai_compatible:text-node-1:1000';
  const clientTaskId = `client:${runtimeTaskId}`;

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'text',
    provider: 'custom_openai_compatible',
    modelId: 'custom_openai_compatible/gpt-5.4',
    nodeId: 'text-node-1',
    canvasId: 'canvas_1',
    status: 'polling',
    recoveryMode: 'local_proxy_poll',
    pollingSpec: {
      kind: 'generation',
      taskType: 'text-generation',
      provider: 'custom_openai_compatible',
      recoveryMode: 'local_proxy_poll',
      targetNodeId: 'text-node-1',
      runtimeTaskId,
      clientTaskId,
    },
    payload: {
      provider: 'custom_openai_compatible',
      model: 'custom_openai_compatible/gpt-5.4',
      nodeId: 'text-node-1',
      runtimeTaskId,
      clientTaskId,
      kind: 'text',
    },
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'text-generation',
    provider: 'custom_openai_compatible',
    modelId: 'custom_openai_compatible/gpt-5.4',
    nodeId: 'text-node-1',
    canvasId: 'canvas_1',
    status: 'success',
    result: {
      id: 'resp_text_1',
      choices: [{ message: { content: '恢复完成文本' } }],
    },
    createdAt: 1000,
    updatedAt: 2000,
    finishedAt: 2000,
  }, { storage, now: 2000 });

  const records = loadAsyncTaskRecords({ storage, now: 2000 });
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, runtimeTaskId);
  assert.equal(records[0].clientTaskId, clientTaskId);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].kind, 'text-generation');
  assert.equal(records[0].resultSpec.outputText, '恢复完成文本');
});

test('asyncTaskStore: text local proxy record keeps resumable mode from pollingSpec when top-level mode is stale', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:text:custom_openai_compatible:text-node-1:1000';
  const clientTaskId = `client:${runtimeTaskId}`;

  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1200,
    items: [
      {
        version: 1,
        runtimeTaskId,
        clientTaskId,
        kind: 'text',
        provider: 'custom_openai_compatible',
        modelId: 'custom_openai_compatible/gpt-5.4',
        nodeId: 'text-node-1',
        canvasId: 'canvas_1',
        status: 'polling',
        canCancel: false,
        canResume: true,
        recoveryMode: 'none',
        recoveryCapability: {
          provider: 'custom_openai_compatible',
          recoveryMode: 'none',
          supportsRemotePoll: false,
          returnsImmediateResult: false,
          supportsLocalProxyRecovery: false,
          requiresQueryableTaskId: false,
        },
        pollingSpec: {
          kind: 'generation',
          taskType: 'text-generation',
          provider: 'custom_openai_compatible',
          recoveryMode: 'local_proxy_poll',
          targetNodeId: 'text-node-1',
          runtimeTaskId,
          clientTaskId,
          startedAt: 1000,
          resumable: true,
          payload: {
            provider: 'custom_openai_compatible',
            model: 'custom_openai_compatible/gpt-5.4',
            nodeId: 'text-node-1',
            runtimeTaskId,
            clientTaskId,
            kind: 'text',
          },
        },
        payload: {
          provider: 'custom_openai_compatible',
          model: 'custom_openai_compatible/gpt-5.4',
          nodeId: 'text-node-1',
          runtimeTaskId,
          clientTaskId,
          kind: 'text',
        },
        createdAt: 1000,
        updatedAt: 1200,
      },
    ],
  }));

  const [record] = loadAsyncTaskRecords({ storage, now: 1300 });
  assert.equal(record.status, 'polling');
  assert.equal(record.recoveryMode, 'local_proxy_poll');
  assert.equal(record.recoveryCapability.supportsLocalProxyRecovery, true);
  assert.equal(record.canResume, true);
  assert.equal(record.clientTaskId, clientTaskId);
});

test('asyncTaskStore: active generation records do not keep stale resultSpec', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'success',
    resultSpec: { imageUrl: '/output/old.png' },
    createdAt: 1000,
    updatedAt: 1100,
  }, { storage, now: 1100 });

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'polling',
    resultSpec: { imageUrl: '/output/old.png' },
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  const [record] = loadAsyncTaskRecords({ storage, now: 1200 });
  assert.equal(record.status, 'polling');
  assert.equal(record.resultSpec, null);
  assert.equal(record.pollingTaskId, '');
  assert.equal(record.queryableTaskId, '');
});

test('asyncTaskStore: GRSAI local proxy frontend interruption stays resumable for refresh recovery', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';

  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1200,
    items: [
      {
        version: 1,
        runtimeTaskId,
        clientTaskId,
        remoteTaskId: '',
        remoteResultId: '',
        queryableTaskId: '',
        pollingTaskId: '',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        canvasId: 'canvas_1',
        status: 'cancelled',
        error: '任务已取消',
        canCancel: false,
        canResume: false,
        recoveryMode: 'local_proxy_poll',
        recoveryCapability: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          supportsRemotePoll: false,
          returnsImmediateResult: true,
          supportsLocalProxyRecovery: true,
          requiresQueryableTaskId: false,
        },
        pollingSpec: {
          provider: 'grsai',
          recoveryMode: 'local_proxy_poll',
          runtimeTaskId,
          clientTaskId,
          targetNodeId: 'node-1',
          resumable: true,
          cancellable: false,
        },
        payload: {
          provider: 'grsai',
          modelId: 'gpt-image-2',
          runtimeTaskId,
          clientTaskId,
          nodeId: 'node-1',
          canvasId: 'canvas_1',
          prompt: '生成蓝色方块',
        },
        createdAt: 1000,
        updatedAt: 1200,
        finishedAt: 1200,
      },
    ],
  }));

  const [record] = loadAsyncTaskRecords({ storage, now: 1300 });
  assert.equal(record.runtimeTaskId, runtimeTaskId);
  assert.equal(record.clientTaskId, clientTaskId);
  assert.equal(record.status, 'polling');
  assert.equal(record.canResume, true);
  assert.equal(record.finishedAt, 0);
  assert.equal(record.error, '');
  assert.equal(record.pollingTaskId, '');
  assert.equal(record.queryableTaskId, '');
  assert.equal(record.recoveryMode, 'local_proxy_poll');
});

test('asyncTaskStore: explicit GRSAI local proxy user cancellation stays terminal', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'cancelled',
    error: '任务已取消',
    cancelReason: 'user',
    canResume: false,
    recoveryMode: 'local_proxy_poll',
    pollingSpec: {
      provider: 'grsai',
      recoveryMode: 'local_proxy_poll',
      runtimeTaskId,
      clientTaskId,
      targetNodeId: 'node-1',
      resumable: true,
    },
    createdAt: 1000,
    updatedAt: 1200,
    finishedAt: 1200,
  }, { storage, now: 1200 });

  const [record] = loadAsyncTaskRecords({ storage, now: 1300 });
  assert.equal(record.status, 'cancelled');
  assert.equal(record.canResume, false);
  assert.equal(record.finishedAt, 1200);
  assert.equal(record.error, '任务已取消');
});

test('asyncTaskStore: GRSAI result id is stored as result metadata, not queryable polling id', () => {
  const storage = createMemoryStorage();
  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:grsai:node-1:1000',
    clientTaskId: 'client-task-1',
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    remoteTaskId: 'result-id-1',
    status: 'running',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].remoteTaskId, 'result-id-1');
  assert.equal(records[0].remoteResultId, 'result-id-1');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].clientTaskId, 'client-task-1');
  assert.equal(records[0].recoveryMode, 'local_proxy_poll');
  assert.equal(records[0].recoveryCapability.supportsRemotePoll, false);
  assert.equal(records[0].recoveryCapability.supportsLocalProxyRecovery, true);
});

test('asyncTaskStore: anonymous GRSAI result id polling record is rejected', () => {
  const storage = createMemoryStorage();
  const record = upsertAsyncTaskRecord({
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    remoteTaskId: 'grsai-result-id-1',
    status: 'polling',
    payload: {
      provider: 'grsai',
      modelId: 'gpt-image-2',
    },
    createdAt: 1200,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  assert.equal(record, null);
  assert.equal(loadAsyncTaskRecords({ storage }).length, 0);
});

test('asyncTaskStore: existing anonymous GRSAI result id polling record is discarded on load', () => {
  const storage = createMemoryStorage();
  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1200,
    items: [
      {
        version: 1,
        runtimeTaskId: 'async:image:grsai:node:grsai-result-id-1',
        clientTaskId: '',
        remoteTaskId: 'grsai-result-id-1',
        remoteResultId: 'grsai-result-id-1',
        queryableTaskId: '',
        pollingTaskId: '',
        recoveryMode: 'local_proxy_poll',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: '',
        status: 'polling',
        payload: {
          provider: 'grsai',
          modelId: 'gpt-image-2',
        },
        createdAt: 1200,
        updatedAt: 1200,
      },
    ],
  }));

  assert.equal(loadAsyncTaskRecords({ storage }).length, 0);
});

test('asyncTaskStore: result-id derived GRSAI local proxy record without client credential is discarded', () => {
  const storage = createMemoryStorage();
  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1200,
    items: [
      {
        version: 1,
        runtimeTaskId: 'async:image:grsai:node-1:15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
        clientTaskId: '',
        remoteTaskId: '15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
        remoteResultId: '15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
        queryableTaskId: '',
        pollingTaskId: '',
        recoveryMode: 'local_proxy_poll',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        status: 'polling',
        pollingSpec: {
          provider: 'grsai',
          targetNodeId: 'node-1',
          runtimeTaskId: 'async:image:grsai:node-1:15-cfa3ba79-2a9c-4281-95d8-d9a9a888b31d',
        },
        createdAt: 1200,
        updatedAt: 1200,
      },
    ],
  }));

  assert.equal(loadAsyncTaskRecords({ storage }).length, 0);
});

test('asyncTaskStore: local proxy task keeps one record across running polling and success writes', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'running',
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    remoteTaskId: 'grsai-result-id-1',
    status: 'success',
    resultSpec: { imageUrl: 'https://example.test/output.png' },
    createdAt: 1000,
    updatedAt: 1600,
    finishedAt: 1600,
  }, { storage, now: 1600 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].runtimeTaskId, runtimeTaskId);
  assert.equal(records[0].clientTaskId, clientTaskId);
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteResultId, 'grsai-result-id-1');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].resultSpec.imageUrl, 'https://example.test/output.png');
});

test('asyncTaskStore: local proxy request payload identity is promoted and updated in place', () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';

  const requestRecord = upsertAsyncTaskRecord({
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    status: 'running',
    payload: {
      provider: 'grsai',
      modelId: 'gpt-image-2',
      runtimeTaskId,
      clientTaskId,
      nodeId: 'node-1',
      canvasId: 'canvas-1',
    },
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    canvasId: 'canvas-1',
    remoteTaskId: 'grsai-result-id-1',
    status: 'success',
    resultSpec: { imageUrl: 'https://example.test/output.png' },
    createdAt: 1000,
    updatedAt: 1600,
    finishedAt: 1600,
  }, { storage, now: 1600 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(requestRecord.runtimeTaskId, runtimeTaskId);
  assert.equal(records[0].runtimeTaskId, runtimeTaskId);
  assert.equal(records[0].clientTaskId, clientTaskId);
  assert.equal(records[0].nodeId, 'node-1');
  assert.equal(records[0].canvasId, 'canvas-1');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteResultId, 'grsai-result-id-1');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
  assert.equal(records[0].resultSpec.imageUrl, 'https://example.test/output.png');
});

test('asyncTaskStore: local proxy duplicate records with same client task are compacted', () => {
  const storage = createMemoryStorage();
  storage.setItem('ai-canvas:async-tasks:v1', JSON.stringify({
    version: 1,
    savedAt: 1600,
    items: [
      {
        version: 1,
        runtimeTaskId: 'async:image:grsai:node-1:success-generated',
        clientTaskId: 'client-task-1',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        remoteTaskId: 'grsai-result-id-1',
        remoteResultId: 'grsai-result-id-1',
        status: 'success',
        resultSpec: { imageUrl: 'https://example.test/output.png' },
        createdAt: 1000,
        updatedAt: 1600,
        finishedAt: 1600,
      },
      {
        version: 1,
        runtimeTaskId: 'async:image:grsai:node-1:polling-generated',
        clientTaskId: 'client-task-1',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        status: 'polling',
        createdAt: 1000,
        updatedAt: 1200,
      },
      {
        version: 1,
        runtimeTaskId: 'async:image:grsai:node-1:1000',
        clientTaskId: 'client-task-1',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        status: 'running',
        createdAt: 1000,
        updatedAt: 1000,
      },
    ],
  }));

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].clientTaskId, 'client-task-1');
  assert.equal(records[0].status, 'success');
  assert.equal(records[0].remoteResultId, 'grsai-result-id-1');
  assert.equal(records[0].pollingTaskId, '');
  assert.equal(records[0].queryableTaskId, '');
});

test('asyncTaskStore: remote poll provider exposes queryableTaskId and recovery capability', () => {
  const storage = createMemoryStorage();
  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:apimart:node-1:1000',
    kind: 'image',
    provider: 'apimart',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    pollingTaskId: 'remote-task-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 1);
  assert.equal(records[0].pollingTaskId, 'remote-task-1');
  assert.equal(records[0].queryableTaskId, 'remote-task-1');
  assert.equal(records[0].recoveryMode, 'remote_poll');
  assert.equal(records[0].recoveryCapability.supportsRemotePoll, true);
  assert.equal(records[0].recoveryCapability.requiresQueryableTaskId, true);
});
