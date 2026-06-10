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
    runtimeTaskId: 'async:provider_async:grsai:node-1:1000',
    kind: 'provider_async',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'running',
    createdAt: 1000,
    updatedAt: 1000,
  }, { storage, now: 1000 });

  const second = upsertAsyncTaskRecord({
    kind: 'image',
    provider: 'grsai',
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
        runtimeTaskId: 'async:image:grsai:node-1:remote-task-1',
        kind: 'image',
        provider: 'grsai',
        modelId: 'gpt-image-2',
        nodeId: 'node-1',
        pollingTaskId: 'remote-task-1',
        status: 'polling',
        createdAt: 1000,
        updatedAt: 1200,
      },
      {
        version: 1,
        runtimeTaskId: 'async:provider_async:grsai:node-1:1000',
        kind: 'provider_async',
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
  assert.equal(records[0].runtimeTaskId, 'async:provider_async:grsai:node-1:1000');
  assert.equal(records[0].kind, 'image');
  assert.equal(records[0].pollingTaskId, 'remote-task-1');
  assert.equal(records[0].createdAt, 1000);
});

test('asyncTaskStore: a new attempt on the same node is not collapsed after previous attempt has remote id', () => {
  const storage = createMemoryStorage();
  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:grsai:node-1:remote-task-1',
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    pollingTaskId: 'remote-task-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1200,
  }, { storage, now: 1200 });

  upsertAsyncTaskRecord({
    runtimeTaskId: 'async:image:grsai:node-1:2000',
    kind: 'image',
    provider: 'grsai',
    modelId: 'gpt-image-2',
    nodeId: 'node-1',
    status: 'running',
    createdAt: 2000,
    updatedAt: 2000,
  }, { storage, now: 2000 });

  const records = loadAsyncTaskRecords({ storage });
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.runtimeTaskId).sort(), [
    'async:image:grsai:node-1:2000',
    'async:image:grsai:node-1:remote-task-1',
  ]);
});