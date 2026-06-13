import test from 'node:test';
import assert from 'node:assert/strict';

import { canRestoreAsyncTaskLoading } from './asyncTaskRuntime.js';

const baseNode = {
  id: 'node-1',
  canvasId: 'canvas-1',
  isGenerating: false,
};

function activeRecord(overrides = {}) {
  return {
    runtimeTaskId: 'runtime-1',
    clientTaskId: 'client-1',
    kind: 'image',
    provider: 'apimart',
    nodeId: 'node-1',
    canvasId: 'canvas-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test('asyncTaskRuntime: remote poll provider restores loading only with queryable task id', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    queryableTaskId: 'poll-1',
    pollingTaskId: 'poll-1',
  }), baseNode), true);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    remoteTaskId: 'result-or-meta-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), false);
});

test('asyncTaskRuntime: GRSAI local proxy recovery uses local credentials, not remote result id', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    remoteTaskId: 'grsai-result-id',
    remoteResultId: 'grsai-result-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), true);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: '',
    clientTaskId: '',
    remoteTaskId: 'grsai-result-id',
    remoteResultId: 'grsai-result-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), false);
});

test('asyncTaskRuntime: terminal node or completed record is not restored to loading', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
    status: 'success',
  }), baseNode), false);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
  }), {
    ...baseNode,
    imageUrl: 'https://cdn.example/result.png',
  }), false);
});

test('asyncTaskRuntime: node with restored image result is settled even when stale generating flag remains', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    pollingTaskId: '',
    queryableTaskId: '',
  }), {
    ...baseNode,
    isGenerating: true,
    generationStartTime: 100,
    generationDuration: null,
    asyncTaskStatus: 'running',
    imageUrl: '/output/restored-grsai.png',
    images: [{ imageUrl: '/output/restored-grsai.png' }],
  }), false);
});

test('asyncTaskRuntime: expired active record is not restored to loading', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
    expiresAt: 900,
  }), baseNode, { now: 1000 }), false);
});