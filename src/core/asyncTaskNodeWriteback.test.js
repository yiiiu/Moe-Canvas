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