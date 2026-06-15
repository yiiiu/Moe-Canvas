import test from 'node:test';
import assert from 'node:assert/strict';

import { cancelTask } from './generationTaskRuntimeTaskCenterBridge.js';
import { loadAsyncTaskRecords, upsertAsyncTaskRecord } from './asyncTaskStore.js';

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

function createStore(node) {
  const state = { nodes: { [node.id]: { ...node } } };
  const updates = [];
  return {
    state,
    updates,
    getState() {
      return state;
    },
    updateNodeData(nodeId, patch) {
      updates.push({ nodeId, patch });
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
}

test('task center cancel releases stuck local proxy node and keeps async record explicitly cancelled', async () => {
  const storage = createMemoryStorage();
  const runtimeTaskId = 'async:image:grsai:node-1:1000';
  const clientTaskId = 'client:async:image:grsai:node-1:1000';
  const recoverySpec = {
    kind: 'generation',
    taskType: 'image',
    provider: 'grsai',
    recoveryMode: 'local_proxy_poll',
    targetNodeId: 'node-1',
    runtimeTaskId,
    clientTaskId,
    startedAt: 1000,
    resumable: true,
    cancellable: true,
    payload: {
      provider: 'grsai',
      runtimeTaskId,
      clientTaskId,
      nodeId: 'node-1',
      kind: 'image',
    },
  };
  upsertAsyncTaskRecord({
    runtimeTaskId,
    clientTaskId,
    kind: 'image',
    provider: 'grsai',
    nodeId: 'node-1',
    status: 'polling',
    canCancel: true,
    canResume: true,
    recoveryMode: 'local_proxy_poll',
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
    createdAt: 1000,
    updatedAt: 1100,
  }, { storage, now: 1100 });

  const store = createStore({
    id: 'node-1',
    isGenerating: true,
    jobStatus: 'loading',
    generationStartTime: 1000,
    asyncRuntimeTaskId: runtimeTaskId,
    asyncClientTaskId: clientTaskId,
    asyncTaskStatus: 'running',
    asyncTaskRecovering: true,
  });
  const taskCenterManager = {
    tasks: new Map([['generation:node-1', {
      taskId: 'generation:node-1',
      nodeId: 'node-1',
      status: 'processing',
      recoverySpec,
    }]]),
    upserts: [],
    upsertTask(task) {
      this.upserts.push(task);
      this.tasks.set(task.taskId, { ...(this.tasks.get(task.taskId) || {}), ...task });
      return task;
    },
  };

  await cancelTask('node-1', {
    store,
    taskCenterManager,
    storage,
    now: () => 1200,
  });

  const node = store.state.nodes['node-1'];
  assert.equal(node.isGenerating, false);
  assert.notEqual(node.jobStatus, 'loading');
  assert.equal(node.asyncTaskStatus, 'cancelled');
  assert.equal(node.asyncTaskRecovering, false);

  const [record] = loadAsyncTaskRecords({ storage, now: 1300 });
  assert.equal(record.runtimeTaskId, runtimeTaskId);
  assert.equal(record.clientTaskId, clientTaskId);
  assert.equal(record.status, 'cancelled');
  assert.equal(record.canResume, false);
  assert.equal(record.cancellationReason, 'user');

  const cancelledTask = taskCenterManager.tasks.get('generation:node-1');
  assert.equal(cancelledTask.status, 'cancelled');
  assert.equal(cancelledTask.canCancel, false);
});