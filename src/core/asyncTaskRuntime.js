import { buildAsyncTaskLoadingPatch } from './asyncTaskAdapters.js';
import { isAsyncTaskRecordActive, loadAsyncTaskRecords } from './asyncTaskStore.js';
import appStore from './stores/appStore.js';

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

function getNode(store, nodeId = '') {
  return getNodes(store)[trimString(nodeId)] || null;
}

function updateNodeData(store, nodeId = '', patch = {}) {
  const targetNodeId = trimString(nodeId);
  if (!targetNodeId || typeof store?.updateNodeData !== 'function') return false;
  store.updateNodeData(targetNodeId, patch);
  return true;
}

function isSameCanvas(record = {}, node = {}) {
  const recordCanvasId = trimString(record.canvasId);
  const nodeCanvasId = trimString(node.canvasId);
  return !recordCanvasId || !nodeCanvasId || recordCanvasId === nodeCanvasId;
}

function getNodeStartedAt(node = {}) {
  return Number(node.generationStartTime || node.asyncTaskStartedAt || node.taskStartedAt || 0) || 0;
}

function collectPrimaryNodeTaskIds(node = {}) {
  return [
    node.asyncTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
    node.generationTaskId,
  ].map(trimString).filter(Boolean);
}

export function canRestoreAsyncTaskLoading(record = {}, node = {}) {
  if (!record?.remoteTaskId || !record?.nodeId || !isAsyncTaskRecordActive(record)) return false;
  if (!node || typeof node !== 'object') return false;
  if (!isSameCanvas(record, node)) return false;
  const primaryTaskIds = collectPrimaryNodeTaskIds(node);
  if (primaryTaskIds.length > 0 && !primaryTaskIds.includes(record.remoteTaskId)) return false;
  const nodeStartedAt = getNodeStartedAt(node);
  const recordStartedAt = Number(record.createdAt || 0) || 0;
  if (nodeStartedAt && recordStartedAt && nodeStartedAt > recordStartedAt && !primaryTaskIds.includes(record.remoteTaskId)) return false;
  return true;
}

export function restoreAsyncTaskLoadingRecords(records = [], options = {}) {
  const store = options.store || appStore;
  const restored = [];
  for (const record of Array.isArray(records) ? records : []) {
    const nodeId = trimString(record.nodeId);
    const node = getNode(store, nodeId);
    if (!canRestoreAsyncTaskLoading(record, node)) continue;
    const patch = buildAsyncTaskLoadingPatch(record);
    if (!updateNodeData(store, nodeId, patch)) continue;
    restored.push({ runtimeTaskId: record.runtimeTaskId, remoteTaskId: record.remoteTaskId, nodeId });
  }
  return restored;
}

function subscribeStoreNodes(store, callback) {
  if (!store || typeof callback !== 'function') return null;
  if (typeof store.subscribeSelector === 'function') {
    return store.subscribeSelector(
      (state) => Object.keys(asObject(state?.nodes)).join('\n'),
      callback,
    );
  }
  if (typeof store.subscribeRaw === 'function') return store.subscribeRaw(callback);
  if (typeof store.subscribe === 'function') return store.subscribe(callback);
  return null;
}

export function restoreAsyncTaskLoadingFromStore(options = {}) {
  const store = options.store || appStore;
  const storage = options.asyncTaskStorage || options.storage;
  const records = loadAsyncTaskRecords({ ...options, storage });
  return restoreAsyncTaskLoadingRecords(records, { ...options, store });
}

export function installAsyncTaskLoadingRecovery(options = {}) {
  const store = options.store || appStore;
  const storage = options.asyncTaskStorage || options.storage;
  const delays = Array.isArray(options.asyncTaskLoadingRetryDelays) ? options.asyncTaskLoadingRetryDelays : [0, 300, 1200, 3000];
  const maxWatchMs = Math.max(0, Number(options.asyncTaskLoadingWatchMs ?? 30000) || 0);
  let stopped = false;
  let latest = [];

  const run = () => {
    if (stopped) return latest;
    latest = restoreAsyncTaskLoadingFromStore({ ...options, store, storage });
    return latest;
  };

  for (const delay of delays) {
    const ms = Math.max(0, Number(delay) || 0);
    if (ms <= 0) {
      run();
      continue;
    }
    const timer = setTimeout(run, ms);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  const unsubscribe = subscribeStoreNodes(store, run);
  if (unsubscribe && maxWatchMs > 0) {
    const timer = setTimeout(() => {
      stopped = true;
      try { unsubscribe?.(); } catch {}
    }, maxWatchMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  return {
    restored: latest,
    stop() {
      stopped = true;
      try { unsubscribe?.(); } catch {}
    },
  };
}

export const __test__ = {
  collectPrimaryNodeTaskIds,
  getNodeStartedAt,
  isSameCanvas,
  subscribeStoreNodes,
};