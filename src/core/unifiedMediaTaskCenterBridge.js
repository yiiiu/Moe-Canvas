import appStore from './stores/appStore.js';
import { upsertUnifiedTaskToTaskCenter } from './unifiedTaskCenterAdapter.js';

const ACTIVE_MEDIA_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending']);
const TERMINAL_MEDIA_STATUSES = new Set(['complete', 'success', 'failed', 'cancelled', 'canceled']);
const LOCAL_MEDIA_TASK_KINDS = new Set([
  'videoProxy',
  'videoPoster',
  'videoFirstFrame',
  'audioWaveform',
  'videoCut',
  'audioCut',
  'videoAudioSeparate',
  'videoCompose',
  'audioCompose',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getStoreState(store) {
  if (!store) return {};
  if (typeof store.getStateRaw === 'function') return asObject(store.getStateRaw());
  if (typeof store.getState === 'function') return asObject(store.getState());
  return asObject(store.state);
}

function getNodes(store) {
  return asObject(getStoreState(store).nodes);
}

function findMediaTaskNodeIds(update = {}, store = appStore) {
  const event = asObject(update);
  const nodes = getNodes(store);
  const nodeId = trimString(event.nodeId || event.targetNodeId || event.sourceNodeId);
  if (nodeId && nodes[nodeId]) return [nodeId];

  const assetId = trimString(event.assetId);
  if (!assetId) return [];

  return Object.values(nodes)
    .filter((node) => trimString(node?.assetId) === assetId)
    .map((node) => node.id)
    .filter(Boolean);
}

function normalizeMediaTaskCenterStatus(status) {
  const text = trimString(status).toLowerCase();
  if (text === 'complete' || text === 'completed' || text === 'success' || text === 'succeeded') return 'success';
  if (text === 'failed' || text === 'failure' || text === 'error') return 'failed';
  if (text === 'cancelled' || text === 'canceled' || text === 'aborted') return 'cancelled';
  if (text === 'processing' || text === 'running') return 'running';
  return 'queued';
}

function buildMediaTaskTitle(update = {}) {
  const kind = trimString(update.kind);
  if (kind === 'videoProxy') return '本地视频转码';
  if (kind === 'videoPoster') return '本地视频封面';
  if (kind === 'videoFirstFrame') return '本地视频抽帧';
  if (kind === 'audioWaveform') return '本地音频波形';
  return '本地媒体处理';
}

function buildMediaTaskResultNodePatch(update = {}) {
  const event = asObject(update);
  const result = asObject(event.result);
  if (!Object.keys(result).length) return {};

  const kind = trimString(event.kind);
  if (kind === 'videoProxy') {
    return {
      displayLocalPath: result.displayLocalPath || result.localPath || '',
      videoProxyStatus: result.videoProxyStatus || '',
      videoCodec: result.videoCodec || '',
    };
  }
  if (kind === 'videoPoster' || kind === 'videoFirstFrame') {
    return {
      posterLocalPath: result.posterLocalPath || result.thumbLocalPath || result.localPath || '',
      thumbUrl: result.posterUrl || result.thumbUrl || result.url || '',
    };
  }
  if (kind === 'audioWaveform') {
    return {
      waveformLocalPath: result.waveformLocalPath || result.localPath || '',
    };
  }
  return {
    localPath: result.localPath || result.displayLocalPath || '',
    thumbUrl: result.thumbUrl || result.posterUrl || '',
  };
}

function normalizePersistedMediaTaskId(taskId) {
  const value = trimString(taskId);
  return value.startsWith('media:') ? value.slice('media:'.length) : value;
}

function buildRestoredMediaTaskNodePatch(task = {}) {
  const unifiedTask = asObject(task.unifiedTask);
  const progress = Number(task.progress || unifiedTask.progress || 0) || 0;
  return {
    mediaTaskId: normalizePersistedMediaTaskId(task.taskId),
    mediaTaskKind: trimString(unifiedTask.model) || trimString(task.kind),
    mediaTaskStatus: 'processing',
    mediaTaskProgress: progress > 0 && progress <= 1 ? progress * 100 : progress,
    mediaTaskError: '',
    isGenerating: true,
    jobStatus: 'loading',
    jobError: null,
  };
}

function normalizeMediaTaskProgressPercent(value) {
  const progress = Number(value || 0) || 0;
  return progress > 0 && progress <= 1 ? progress * 100 : progress;
}

function buildActiveMediaTaskNodePatch(update = {}, node = {}) {
  const event = asObject(update);
  return {
    mediaTaskId: normalizePersistedMediaTaskId(event.taskId || event.mediaTaskId || node.mediaTaskId),
    mediaTaskKind: trimString(event.kind) || trimString(node.mediaTaskKind),
    mediaTaskStatus: 'processing',
    mediaTaskProgress: normalizeMediaTaskProgressPercent(event.progress ?? node.mediaTaskProgress),
    mediaTaskError: '',
    isGenerating: true,
    jobStatus: 'loading',
    jobError: null,
  };
}

function ensureActiveMediaTaskNodesLoading(update = {}, store = appStore) {
  const event = asObject(update);
  const status = trimString(event.status).toLowerCase();
  if (!ACTIVE_MEDIA_STATUSES.has(status)) return [];
  const nodeIds = findMediaTaskNodeIds(event, store);
  if (!nodeIds.length) return [];
  const nodes = getNodes(store);
  if (typeof store.updateNodesData === 'function' && nodeIds.length > 1) {
    const updates = {};
    nodeIds.forEach((nodeId) => {
      updates[nodeId] = buildActiveMediaTaskNodePatch(event, asObject(nodes[nodeId]));
    });
    store.updateNodesData(updates);
  } else if (typeof store.updateNodeData === 'function') {
    nodeIds.forEach((nodeId) => store.updateNodeData(nodeId, buildActiveMediaTaskNodePatch(event, asObject(nodes[nodeId]))));
  }
  return nodeIds.map((nodeId) => ({ taskId: event.taskId || event.mediaTaskId || '', nodeId }));
}

function buildTerminalMediaTaskNodePatch(task = {}) {
  const status = trimString(task.status).toLowerCase();
  const isFailed = status === 'failed';
  const isComplete = status === 'complete' || status === 'success';
  const error = trimString(task.error || task.unifiedTask?.error?.message);
  return {
    mediaTaskId: normalizePersistedMediaTaskId(task.taskId),
    mediaTaskKind: trimString(task.unifiedTask?.model) || trimString(task.kind),
    mediaTaskStatus: isComplete ? 'complete' : (isFailed ? 'failed' : 'cancelled'),
    mediaTaskError: isFailed ? (error || 'Media task failed') : '',
    isGenerating: false,
    jobStatus: isComplete ? 'success' : (isFailed ? 'error' : null),
    jobError: isFailed ? (error || 'Media task failed') : null,
  };
}

function isSameMediaTaskNode(task = {}, node = {}) {
  const taskId = normalizePersistedMediaTaskId(task.taskId);
  const nodeTaskId = normalizePersistedMediaTaskId(node.mediaTaskId);
  if (taskId && nodeTaskId) return taskId === nodeTaskId;
  const taskNodeId = trimString(task.nodeId);
  if (taskNodeId && trimString(node.id) === taskNodeId && node.isGenerating === true) return true;
  return false;
}

function isRestorableMediaTask(task = {}) {
  const kind = trimString(task.kind);
  return kind === 'mediaTask' || LOCAL_MEDIA_TASK_KINDS.has(kind) || task?.unifiedTask?.kind === 'media' || trimString(task?.taskId).startsWith('media:');
}

function applyNodePatch(store, nodeIds = [], patch = {}) {
  if (!store || !nodeIds.length) return;
  if (typeof store.updateNodesData === 'function' && nodeIds.length > 1) {
    const updates = {};
    nodeIds.forEach((nodeId) => { updates[nodeId] = patch; });
    store.updateNodesData(updates);
    return;
  }
  if (typeof store.updateNodeData === 'function') {
    nodeIds.forEach((nodeId) => store.updateNodeData(nodeId, patch));
  }
}

export function restoreRestoredMediaTasks(tasks = [], options = {}) {
  const store = options.store || appStore;
  const restored = [];
  const nodes = getNodes(store);
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const status = trimString(task?.status).toLowerCase();
    if (!ACTIVE_MEDIA_STATUSES.has(status) && !TERMINAL_MEDIA_STATUSES.has(status)) continue;
    if (!isRestorableMediaTask(task)) continue;
    const nodeIds = findMediaTaskNodeIds({ nodeId: task.nodeId, assetId: task.assetId }, store);
    if (!nodeIds.length) continue;
    if (ACTIVE_MEDIA_STATUSES.has(status)) {
      applyNodePatch(store, nodeIds, buildRestoredMediaTaskNodePatch(task));
      restored.push(...nodeIds.map((nodeId) => ({ taskId: task.taskId, nodeId })));
      continue;
    }
    const matchedNodeIds = nodeIds.filter((nodeId) => isSameMediaTaskNode(task, { id: nodeId, ...asObject(nodes[nodeId]) }));
    if (!matchedNodeIds.length) continue;
    applyNodePatch(store, matchedNodeIds, buildTerminalMediaTaskNodePatch(task));
    restored.push(...matchedNodeIds.map((nodeId) => ({ taskId: task.taskId, nodeId })));
  }
  return restored;
}

export function syncMediaTaskUpdateToTaskCenter(update = {}, options = {}) {
  const event = asObject(update);
  const store = options.store || appStore;
  ensureActiveMediaTaskNodesLoading(event, store);

  const manager = options.taskCenterManager || globalThis.window?.__aiCanvasTaskCenterManager || null;
  if (!manager || typeof manager.upsertTask !== 'function') return [];

  const nodes = getNodes(store);
  const nodeIds = findMediaTaskNodeIds(event, store);
  const fallbackNodeId = trimString(event.nodeId || event.targetNodeId || event.sourceNodeId);
  const assetId = trimString(event.assetId);
  const targets = nodeIds.length ? nodeIds : [fallbackNodeId].filter(Boolean);
  if (!targets.length && !assetId) return [];

  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const status = normalizeMediaTaskCenterStatus(event.status);
  const synced = [];

  for (const nodeId of targets.length ? targets : ['']) {
    const node = asObject(nodes[nodeId]);
    const taskId = trimString(event.taskId || event.mediaTaskId) || trimString(node.mediaTaskId) || (nodeId ? `${nodeId}:media` : `${assetId}:media`);
    const task = upsertUnifiedTaskToTaskCenter({
      spec: {
        id: `media:${taskId}`,
        taskType: 'media',
        targetNodeId: nodeId,
        provider: 'local',
        modelId: trimString(event.kind) || trimString(node.mediaTaskKind),
        adapterType: 'local-runtime',
        title: buildMediaTaskTitle(event),
        cancellable: ACTIVE_MEDIA_STATUSES.has(trimString(event.status).toLowerCase()),
      },
      node: { id: nodeId, assetId, ...node, ...buildMediaTaskResultNodePatch(event) },
      nodeId,
      status,
      progress: Number(event.progress ?? node.mediaTaskProgress ?? 0) || 0,
      error: event.error || node.mediaTaskError || null,
      now,
      taskCenterExtras: {
        assetId: assetId || trimString(node.assetId),
      },
    }, manager);
    if (task) synced.push(task);
  }

  return synced;
}

export const __test__ = {
  findMediaTaskNodeIds,
  normalizeMediaTaskCenterStatus,
};