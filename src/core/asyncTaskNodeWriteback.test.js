import test from 'node:test';
import assert from 'node:assert/strict';

import { writeAsyncTaskNodeBackfill } from './asyncTaskNodeWriteback.js';

function createStore(nodes = {}) {
  const updates = [];
  const state = { nodes: { ...nodes } };
  return {
    updates,
    getState() {
      return state;
    },
    updateNodeData(nodeId, patch) {
      updates.push({ nodeId, patch });
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };
}

test('asyncTaskNodeWriteback writes success result only to matching node and canvas', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncRuntimeTaskId: 'runtime-1',
      asyncClientTaskId: 'client-1',
      generationStartTime: 100,
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
    },
    resultPatch: {
      imageUrl: '/output/grsai.png',
      localPath: 'output/grsai.png',
      displayLocalPath: 'output/grsai.png',
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.reason, 'updated');
  assert.equal(store.updates.length, 1);
  assert.equal(store.updates[0].nodeId, 'node-1');
  assert.equal(store.getState().nodes['node-1'].imageUrl, '/output/grsai.png');
  assert.equal(store.getState().nodes['node-1'].localPath, 'output/grsai.png');
  assert.equal(store.getState().nodes['node-1'].displayLocalPath, 'output/grsai.png');
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'success');
  assert.equal(store.getState().nodes['node-1'].asyncRuntimeTaskId, null);
  assert.equal(store.getState().nodes['node-1'].asyncClientTaskId, null);
});

test('asyncTaskNodeWriteback rejects canvas mismatch without touching node', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-actual',
      isGenerating: true,
      jobStatus: 'loading',
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-1',
      kind: 'image',
      nodeId: 'node-1',
      canvasId: 'canvas-other',
      status: 'success',
    },
    resultPatch: { imageUrl: '/output/wrong.png' },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'canvas-mismatch');
  assert.equal(store.updates.length, 0);
  assert.equal(store.getState().nodes['node-1'].imageUrl, undefined);
  assert.equal(store.getState().nodes['node-1'].isGenerating, true);
});

test('asyncTaskNodeWriteback skips missing node without throwing', () => {
  const store = createStore({});

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-1',
      kind: 'image',
      nodeId: 'missing-node',
      canvasId: 'canvas-1',
      status: 'failed',
      error: '上游额度不足',
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'node-not-found');
  assert.equal(store.updates.length, 0);
});

test('asyncTaskNodeWriteback writes failed terminal state with readable error', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncTaskId: 'poll-1',
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-1',
      kind: 'image',
      provider: 'apimart',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'failed',
      error: { message: 'apikey credits not enough' },
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(store.getState().nodes['node-1'].isGenerating, false);
  assert.equal(store.getState().nodes['node-1'].jobStatus, 'error');
  assert.equal(store.getState().nodes['node-1'].jobError, 'apikey credits not enough');
  assert.equal(store.getState().nodes['node-1'].asyncTaskId, null);
});

test('asyncTaskNodeWriteback failure clears stale image result patch', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-1',
      isGenerating: false,
      jobStatus: 'success',
      imageUrl: '/output/previous.png',
      images: [{ imageUrl: '/output/previous.png' }],
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      status: 'failed',
      error: 'guardrails failed',
    },
    resultPatch: {
      imageUrl: '/output/stale-from-cache.png',
      images: [{ imageUrl: '/output/stale-from-cache.png' }],
      localPath: 'output/stale-from-cache.png',
    },
  });

  const node = store.getState().nodes['node-1'];
  assert.equal(outcome.ok, true);
  assert.equal(node.jobStatus, 'error');
  assert.equal(node.jobError, 'guardrails failed');
  assert.equal(node.imageUrl, null);
  assert.equal(node.localPath, null);
  assert.deepEqual(node.images, []);
});

test('asyncTaskNodeWriteback failure clears stale status card success code with error code', () => {
  const store = createStore({
    'node-1': {
      id: 'node-1',
      canvasId: 'canvas-1',
      jobStatus: 'success',
      rhStatusCode: 0,
      rhStatusMessage: 'previous success',
      rhTaskStatus: 'success',
      rhTaskLabel: '生成成功',
      dreaminaTaskStatus: 'success',
      dreaminaTaskPhase: 'succeeded',
      dreaminaTaskLabel: '生成成功',
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-1',
      kind: 'image',
      provider: 'grsai',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      status: 'failed',
      error: '[GRSAI] guardrails failed (错误码: 400)',
    },
  });

  const node = store.getState().nodes['node-1'];
  assert.equal(outcome.ok, true);
  assert.equal(node.jobStatus, 'error');
  assert.equal(node.jobError, '[GRSAI] guardrails failed (错误码: 400)');
  assert.equal(node.rhStatusCode, 400);
  assert.equal(node.rhStatusMessage, '[GRSAI] guardrails failed (错误码: 400)');
  assert.equal(node.rhTaskStatus, 'failed');
  assert.equal(node.rhTaskLabel, '生成失败');
  assert.equal(node.dreaminaTaskStatus, 'failed');
  assert.equal(node.dreaminaTaskPhase, 'failed');
  assert.equal(node.dreaminaTaskLabel, '生成失败');
});

test('asyncTaskNodeWriteback text success bumps biz revision for mounted renderer update', () => {
  const store = createStore({
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncRuntimeTaskId: 'runtime-text-1',
      asyncClientTaskId: 'client-text-1',
      generationStartTime: 100,
      asyncTaskStartedAt: 100,
      textTaskStatus: 'running',
      textTaskRecovering: true,
      data: {
        id: 'text-node-1',
        canvasId: 'canvas-1',
        generationStartTime: 100,
        asyncTaskStartedAt: 100,
        textTaskStatus: 'running',
        textTaskRecovering: true,
        generationDuration: 7000,
      },
      generationDuration: 7000,
      _bizRev: 7,
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-text-1',
      kind: 'text-generation',
      provider: 'custom_openai_compatible',
      nodeId: 'text-node-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
    },
    resultPatch: {
      outputText: '刷新恢复后的文本',
    },
  });

  const node = store.getState().nodes['text-node-1'];
  assert.equal(outcome.ok, true);
  assert.equal(node.outputText, '刷新恢复后的文本');
  assert.equal(node.isGenerating, false);
  assert.equal(node.jobStatus, 'success');
  assert.equal(node.asyncTaskStatus, 'success');
  assert.equal(node.asyncRuntimeTaskId, null);
  assert.equal(node.asyncClientTaskId, null);
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
  assert.equal(node._bizRev, 8);
});

test('asyncTaskNodeWriteback text success does not let response id replace node identity', () => {
  const store = createStore({
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      _bizRev: 2,
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-text-1',
      kind: 'text-generation',
      provider: 'custom_openai_compatible',
      nodeId: 'text-node-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
    },
    resultPatch: {
      id: 'resp_ghost_text_1',
      nodeId: 'resp_ghost_text_1',
      targetNodeId: 'resp_ghost_text_1',
      canvasId: 'canvas-from-response',
      remoteResultId: 'resp_ghost_text_1',
      outputText: '恢复成功文本',
    },
  });

  const node = store.getState().nodes['text-node-1'];
  assert.equal(outcome.ok, true);
  assert.equal(outcome.nodeId, 'text-node-1');
  assert.equal(store.updates[0].nodeId, 'text-node-1');
  assert.equal(node.id, 'text-node-1');
  assert.equal(node.nodeId, undefined);
  assert.equal(node.targetNodeId, undefined);
  assert.equal(node.canvasId, 'canvas-1');
  assert.equal(node.remoteResultId, 'resp_ghost_text_1');
  assert.equal(node.outputText, '恢复成功文本');
  assert.equal(node._bizRev, 3);
});

test('asyncTaskNodeWriteback prefers recovery target node over stale outer node id', () => {
  const store = createStore({
    'stale-source-node': {
      id: 'stale-source-node',
      type: 'ai-text',
      canvasId: 'canvas-1',
      outputText: '底层节点原文本',
      _bizRev: 3,
    },
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncRuntimeTaskId: 'runtime-text-1',
      asyncClientTaskId: 'client-text-1',
      _bizRev: 7,
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-text-1',
      kind: 'text-generation',
      provider: 'custom_openai_compatible',
      nodeId: 'stale-source-node',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
      recoverySpec: {
        targetNodeId: 'text-node-1',
        sourceNodeId: 'stale-source-node',
        taskType: 'text-generation',
        recoveryMode: 'local_proxy_poll',
      },
    },
    resultPatch: {
      outputText: '应写入目标文本节点',
    },
  });

  const nodes = store.getState().nodes;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.nodeId, 'text-node-1');
  assert.equal(nodes['text-node-1'].outputText, '应写入目标文本节点');
  assert.equal(nodes['text-node-1']._bizRev, 8);
  assert.equal(nodes['stale-source-node'].outputText, '底层节点原文本');
  assert.equal(nodes['stale-source-node']._bizRev, 3);
});

test('asyncTaskNodeWriteback writes video success result patch and exits loading', () => {
  const store = createStore({
    'video-1': {
      id: 'video-1',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncTaskId: 'video-poll-1',
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-video-1',
      kind: 'video',
      provider: 'runninghub',
      nodeId: 'video-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
    },
    resultPatch: {
      videoUrl: '/output/video-final.mp4',
      localPath: 'output/video-final.mp4',
      displayLocalPath: 'output/video-final.mp4',
      thumbUrl: '/output/video-thumb.png',
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(store.getState().nodes['video-1'].isGenerating, false);
  assert.equal(store.getState().nodes['video-1'].jobStatus, 'success');
  assert.equal(store.getState().nodes['video-1'].videoUrl, '/output/video-final.mp4');
  assert.equal(store.getState().nodes['video-1'].localPath, 'output/video-final.mp4');
  assert.equal(store.getState().nodes['video-1'].displayLocalPath, 'output/video-final.mp4');
  assert.equal(store.getState().nodes['video-1'].thumbUrl, '/output/video-thumb.png');
  assert.equal(store.getState().nodes['video-1'].asyncTaskId, null);
});

test('asyncTaskNodeWriteback writes audio success result patch and exits loading', () => {
  const store = createStore({
    'audio-1': {
      id: 'audio-1',
      canvasId: 'canvas-1',
      isGenerating: true,
      jobStatus: 'loading',
      asyncTaskId: 'audio-poll-1',
    },
  });

  const outcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'success',
    task: {
      id: 'task-audio-1',
      kind: 'audio',
      provider: 'runninghub',
      nodeId: 'audio-1',
      canvasId: 'canvas-1',
      startedAt: 100,
      status: 'success',
    },
    resultPatch: {
      audioUrl: '/output/audio-final.wav',
      src: '/output/audio-final.wav',
      localPath: 'output/audio-final.wav',
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(store.getState().nodes['audio-1'].isGenerating, false);
  assert.equal(store.getState().nodes['audio-1'].jobStatus, 'success');
  assert.equal(store.getState().nodes['audio-1'].audioUrl, '/output/audio-final.wav');
  assert.equal(store.getState().nodes['audio-1'].src, '/output/audio-final.wav');
  assert.equal(store.getState().nodes['audio-1'].localPath, 'output/audio-final.wav');
  assert.equal(store.getState().nodes['audio-1'].asyncTaskId, null);
});

test('asyncTaskNodeWriteback writes video and audio failures with readable errors', () => {
  const store = createStore({
    'video-1': { id: 'video-1', canvasId: 'canvas-1', isGenerating: true, jobStatus: 'loading' },
    'audio-1': { id: 'audio-1', canvasId: 'canvas-1', isGenerating: true, jobStatus: 'loading' },
  });

  const videoOutcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-video-1',
      kind: 'video',
      nodeId: 'video-1',
      canvasId: 'canvas-1',
      status: 'failed',
      error: { detail: '视频生成失败' },
    },
  });
  const audioOutcome = writeAsyncTaskNodeBackfill({
    store,
    phase: 'failed',
    task: {
      id: 'task-audio-1',
      kind: 'audio',
      nodeId: 'audio-1',
      canvasId: 'canvas-1',
      status: 'failed',
      error: { reason: '音频生成失败' },
    },
  });

  assert.equal(videoOutcome.ok, true);
  assert.equal(audioOutcome.ok, true);
  assert.equal(store.getState().nodes['video-1'].isGenerating, false);
  assert.equal(store.getState().nodes['video-1'].jobStatus, 'error');
  assert.equal(store.getState().nodes['video-1'].jobError, '视频生成失败');
  assert.equal(store.getState().nodes['audio-1'].isGenerating, false);
  assert.equal(store.getState().nodes['audio-1'].jobStatus, 'error');
  assert.equal(store.getState().nodes['audio-1'].jobError, '音频生成失败');
});