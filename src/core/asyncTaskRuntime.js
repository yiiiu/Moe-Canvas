import { buildAsyncTaskLoadingPatch } from './asyncTaskAdapters.js';
import { isAsyncTaskRecordActive, loadAsyncTaskRecords } from './asyncTaskStore.js';
import {
  hasAsyncTaskLocalRecoveryCredential,
  resolveAsyncTaskQueryableTaskId,
  resolveAsyncTaskRecoveryCapability,
} from './asyncTaskRecoveryCapabilities.js';
import appStore from './stores/appStore.js';
import { startPreviewNodeLoading, syncPreviewNodeLoading, isPreviewNodeLoading } from '../modules/previewMode.js';

const DEFAULT_LOADING_RETRY_DELAYS = [0, 50, 150, 300, 600, 1000, 1500, 2200, 3000, 4000];
const DEFAULT_LOADING_OVERLAY_INTERVAL_MS = 100;
const DEFAULT_LOADING_OVERLAY_FAST_MS = 4000;
const DEFAULT_LOADING_WATCH_MS = 6000;
const ASYNC_LOADING_DIAG_KEY = '__AI_CANVAS_ASYNC_LOADING_RECOVERY_DIAG__';
const ASYNC_LOADING_DUMP_KEY = '__AI_CANVAS_DUMP_ASYNC_LOADING_RECOVERY__';
const ASYNC_LOADING_MAX_DIAG_EVENTS = 500;
let installedAsyncTaskLoadingRecovery = null;

function getNowMs() {
  try {
    if (globalThis.performance && typeof globalThis.performance.now === 'function') return globalThis.performance.now();
  } catch {}
  return Date.now();
}

function normalizeDiagValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => normalizeDiagValue(item, depth + 1));
  if (typeof value !== 'object' || depth > 1) return String(value);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/authorization|api[-_]?key|headers|payload|request|body/i.test(key)) continue;
    output[key] = normalizeDiagValue(item, depth + 1);
  }
  return output;
}

function getLoadingRecoveryDiag() {
  const root = globalThis;
  const existing = root[ASYNC_LOADING_DIAG_KEY];
  if (existing && typeof existing === 'object') return existing;
  const startedAt = getNowMs();
  const diag = {
    startedAt,
    createdAt: new Date().toISOString(),
    events: [],
    first: {},
    last: {},
    counts: {},
  };
  root[ASYNC_LOADING_DIAG_KEY] = diag;
  root[ASYNC_LOADING_DUMP_KEY] = () => buildLoadingRecoveryDiagDump(diag);
  return diag;
}

function buildLoadingRecoveryDiagDump(diag = {}) {
  const events = Array.isArray(diag.events) ? diag.events : [];
  const nonTickEvents = events.filter((event) => event?.type !== 'fast-recovery-tick');
  const overlayCalls = events.filter((event) => event?.type === 'overlay-call');
  const recordChecks = events.filter((event) => event?.type === 'record-check');
  const restoreResults = events.filter((event) => event?.type === 'restore-result');
  const firstNodeFound = recordChecks.find((event) => event.nodeFound);
  const firstCanRestore = recordChecks.find((event) => event.canRestore);
  const firstNodeUpdate = events.find((event) => event?.type === 'node-update-called');
  const firstDomFound = events.find((event) => event?.type === 'dom-container-found');
  const firstOverlayCall = overlayCalls[0] || null;
  const firstOverlayElement = overlayCalls.find((event) => event.hasOverlay) || null;
  const firstRestored = restoreResults.find((event) => Number(event.restoredCount || 0) > 0) || null;
  const installStart = diag.first?.['install-start'] || events.find((event) => event?.type === 'install-start') || null;
  return {
    createdAt: diag.createdAt,
    elapsedMs: Math.round((getNowMs() - diag.startedAt) * 10) / 10,
    counts: { ...asObject(diag.counts) },
    diagnosis: {
      installSource: installStart?.source || '',
      installedAtMs: installStart?.dt,
      firstNodeFoundMs: firstNodeFound?.dt,
      firstCanRestoreMs: firstCanRestore?.dt,
      firstNodeUpdateMs: firstNodeUpdate?.dt,
      firstDomFoundMs: firstDomFound?.dt,
      firstOverlayCallMs: firstOverlayCall?.dt,
      firstOverlayElementMs: firstOverlayElement?.dt,
      firstRestoredMs: firstRestored?.dt,
      lastRestore: diag.last?.['restore-result'] || null,
      lastRecordCheck: diag.last?.['record-check'] || null,
      lastOverlay: diag.last?.['overlay-call'] || diag.last?.['overlay-skipped'] || null,
      hydrationPatch: diag.first?.['hydrate-patch-installed'] || diag.last?.['hydrate-patch-skipped'] || null,
      firstHydratedNodeMs: diag.first?.['hydrate-node-patched']?.dt,
      firstHydratedCanvasMs: diag.first?.['hydrate-canvas-patched']?.dt,
      lastHydratedNode: diag.last?.['hydrate-node-patched'] || null,
      storeSubscribe: diag.first?.['store-subscribe-installed'] || diag.last?.['store-subscribe-skipped'] || null,
      domObserver: diag.first?.['dom-observer-installed'] || diag.last?.['dom-observer-skipped'] || null,
    },
    first: normalizeDiagValue(diag.first),
    last: normalizeDiagValue(diag.last),
    recentImportantEvents: nonTickEvents.slice(-120),
  };
}

function noteLoadingRecoveryDiag(type, detail = {}) {
  try {
    const diag = getLoadingRecoveryDiag();
    const now = getNowMs();
    const event = {
      t: Math.round(now * 10) / 10,
      dt: Math.round((now - diag.startedAt) * 10) / 10,
      type,
      ...normalizeDiagValue(detail),
    };
    diag.counts[type] = Number(diag.counts[type] || 0) + 1;
    if (!diag.first[type]) diag.first[type] = event;
    if (type !== 'fast-recovery-tick' || diag.counts[type] <= 5 || diag.counts[type] % 10 === 0) {
      diag.events.push(event);
      if (diag.events.length > ASYNC_LOADING_MAX_DIAG_EVENTS) diag.events.splice(0, diag.events.length - ASYNC_LOADING_MAX_DIAG_EVENTS);
    }
    diag.last[type] = event;
  } catch {}
}

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

function normalizeNodesById(nodes) {
  if (Array.isArray(nodes)) {
    return nodes.reduce((map, node) => {
      const item = asObject(node);
      const data = asObject(item.data);
      const nodeId = trimString(item.id || item.nodeId || data.id || data.nodeId);
      if (nodeId) map[nodeId] = { ...data, ...item, data };
      return map;
    }, {});
  }
  return asObject(nodes);
}

function getNodes(store) {
  return normalizeNodesById(getStoreState(store).nodes);
}

function getNodeData(node = {}) {
  return {
    ...asObject(node?.data),
    ...asObject(node),
  };
}

function updateNodeData(store, nodeId = '', patch = {}) {
  const targetNodeId = trimString(nodeId);
  if (!targetNodeId || typeof store?.updateNodeData !== 'function') {
    noteLoadingRecoveryDiag('node-update-skipped', {
      nodeId: targetNodeId,
      hasUpdateNodeData: typeof store?.updateNodeData === 'function',
    });
    return false;
  }
  store.updateNodeData(targetNodeId, patch);
  noteLoadingRecoveryDiag('node-update-called', {
    nodeId: targetNodeId,
    patchKeys: Object.keys(asObject(patch)),
    asyncTaskStatus: patch.asyncTaskStatus,
    isGenerating: patch.isGenerating,
    jobStatus: patch.jobStatus,
  });
  return true;
}

function cssEscape(value = '') {
  const text = String(value || '');
  if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(text);
  return text.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function findNodeLoadingContainer(nodeId = '') {
  const id = trimString(nodeId);
  if (!id || !globalThis.document?.querySelector) {
    noteLoadingRecoveryDiag('dom-node-missing', { nodeId: id, reason: !id ? 'empty-node-id' : 'no-document' });
    return null;
  }
  const escaped = cssEscape(id);
  const nodeSelectors = [
    `.v2-node[data-node-id="${escaped}"]`,
    `.v2-node [data-node-id="${escaped}"]`,
    `[data-node-id="${escaped}"]`,
  ];
  const directNode = document.querySelector(nodeSelectors[0]);
  const nestedNode = document.querySelector(nodeSelectors[1])?.closest?.('.v2-node');
  const idNode = document.getElementById?.(id);
  const dataNode = document.querySelector(nodeSelectors[2])?.closest?.('.v2-node') || document.querySelector(nodeSelectors[2]);
  const nodeEl = directNode || nestedNode || idNode || dataNode;
  if (!nodeEl) {
    noteLoadingRecoveryDiag('dom-node-missing', { nodeId: id, selectors: nodeSelectors });
    return null;
  }
  const selectors = [
    '.img-node-preview',
    '.video-node-preview',
    '.audio-node-preview',
    '.video-preview',
    '.audio-preview',
    '.media-preview',
    '.v2-media-preview',
    '.node-preview',
    '.node-card',
  ];
  for (const selector of selectors) {
    const container = nodeEl.querySelector?.(selector);
    if (container) {
      noteLoadingRecoveryDiag('dom-container-found', { nodeId: id, selector });
      return container;
    }
  }
  noteLoadingRecoveryDiag('dom-container-found', { nodeId: id, selector: 'nodeEl' });
  return nodeEl;
}

function restoreNodeLoadingOverlay(record = {}) {
  const nodeId = trimString(record.nodeId);
  try {
    const container = findNodeLoadingContainer(nodeId);
    if (!container) {
      noteLoadingRecoveryDiag('overlay-skipped', { nodeId, reason: 'no-container' });
      return false;
    }
    const wasLoading = isPreviewNodeLoading(nodeId);
    const restored = wasLoading
      ? syncPreviewNodeLoading(nodeId, container, { variant: 'full' })
      : startPreviewNodeLoading(nodeId, container, { variant: 'full' });
    noteLoadingRecoveryDiag('overlay-call', {
      nodeId,
      method: wasLoading ? 'sync' : 'start',
      restored: Boolean(restored),
      hasOverlay: Boolean(container.querySelector?.('.img-loading-overlay')),
      className: container.className,
    });
    return restored;
  } catch (error) {
    noteLoadingRecoveryDiag('overlay-error', { nodeId, message: error?.message || String(error) });
    return false;
  }
}

function isSameCanvas(record = {}, node = {}) {
  const recordCanvasId = trimString(record.canvasId);
  const nodeCanvasId = trimString(node.canvasId);
  return !recordCanvasId || !nodeCanvasId || recordCanvasId === nodeCanvasId;
}

function getNodeStartedAt(node = {}) {
  return Number(node.generationStartTime || node.asyncTaskStartedAt || node.taskStartedAt || 0) || 0;
}

const NODE_TERMINAL_STATUSES = new Set([
  'success',
  'succeeded',
  'complete',
  'completed',
  'done',
  'finished',
  'failed',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'interrupted',
]);

function normalizeStatusText(value) {
  return String(value || '').trim().toLowerCase();
}

function hasUsableResultItem(item = {}) {
  const value = asObject(item);
  if (!value || trimString(value.error)) return false;
  return Boolean(trimString(value.imageUrl)
    || trimString(value.url)
    || trimString(value.sourceUrl)
    || trimString(value.thumbUrl)
    || trimString(value.videoUrl)
    || trimString(value.audioUrl)
    || trimString(value.localPath)
    || trimString(value.displayLocalPath));
}

function hasNodeGenerationResult(node = {}) {
  return Boolean(trimString(node.imageUrl)
    || trimString(node.sourceUrl)
    || trimString(node.videoUrl)
    || trimString(node.audioUrl)
    || trimString(node.localPath)
    || trimString(node.displayLocalPath)
    || trimString(node.posterLocalPath)
    || trimString(node.thumbUrl)
    || (Array.isArray(node.images) && node.images.some(hasUsableResultItem))
    || (Array.isArray(node.videos) && node.videos.some(hasUsableResultItem))
    || (Array.isArray(node.audios) && node.audios.some(hasUsableResultItem)));
}

function isNodeGenerationSettled(node = {}) {
  if (hasNodeGenerationResult(node)) return true;
  const statuses = [
    node.jobStatus,
    node.asyncTaskStatus,
    node.textTaskStatus,
    node.taskStatus,
    node.status,
  ].map(normalizeStatusText).filter(Boolean);
  return statuses.some((status) => NODE_TERMINAL_STATUSES.has(status)) || hasNodeGenerationResult(node);
}

function hasRecoverablePollingTaskId(record = {}) {
  return Boolean(resolveAsyncTaskQueryableTaskId(record));
}

function requiresPollingTaskIdForRecovery(record = {}) {
  const capability = resolveAsyncTaskRecoveryCapability(record);
  return capability.supportsRemotePoll === true;
}

function isRecoverableAsyncTaskRecord(record = {}) {
  const capability = resolveAsyncTaskRecoveryCapability(record);
  if (capability.supportsRemotePoll) return hasRecoverablePollingTaskId(record);
  if (capability.supportsLocalProxyRecovery) return hasAsyncTaskLocalRecoveryCredential(record);
  return !requiresPollingTaskIdForRecovery(record);
}

function collectPrimaryNodeTaskIds(node = {}) {
  return [
    node.asyncTaskId,
    node.pollingTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
    node.generationTaskId,
  ].map(trimString).filter(Boolean);
}

export function canRestoreAsyncTaskLoading(record = {}, node = {}, options = {}) {
  if (!record?.nodeId || !isAsyncTaskRecordActive(record)) return false;
  const expiresAt = Number(record.expiresAt || 0) || 0;
  const now = Number(options.now || Date.now()) || Date.now();
  if (expiresAt && expiresAt <= now) return false;
  if (!isRecoverableAsyncTaskRecord(record)) return false;
  if (!node || typeof node !== 'object') return false;
  const nodeData = getNodeData(node);
  const capability = resolveAsyncTaskRecoveryCapability(record);
  const debugNodeSettled = isNodeGenerationSettled(nodeData);
  let debugDecision = 'continue';
  let debugResult = false;
  if (!isSameCanvas(record, nodeData)) {
    debugDecision = 'canvas-mismatch';
  } else if (debugNodeSettled) {
    debugDecision = 'node-settled';
  } else {
    const runtimeTaskId = trimString(record.runtimeTaskId);
    const nodeRuntimeTaskId = trimString(nodeData.asyncRuntimeTaskId || nodeData.runtimeTaskId);
    if (runtimeTaskId && nodeRuntimeTaskId && runtimeTaskId !== nodeRuntimeTaskId) {
      debugDecision = 'runtime-mismatch';
    } else {
      const pollingTaskId = resolveAsyncTaskQueryableTaskId(record);
      const primaryTaskIds = collectPrimaryNodeTaskIds(nodeData);
      if (!pollingTaskId && primaryTaskIds.length > 0 && !(runtimeTaskId && nodeRuntimeTaskId === runtimeTaskId)) {
        debugDecision = 'primary-task-without-match';
      } else if (pollingTaskId && primaryTaskIds.length > 0 && !primaryTaskIds.includes(pollingTaskId)) {
        debugDecision = 'polling-mismatch';
      } else {
        const nodeStartedAt = getNodeStartedAt(nodeData);
        const recordStartedAt = Number(record.createdAt || 0) || 0;
        if (nodeStartedAt && recordStartedAt && nodeStartedAt > recordStartedAt) {
          if (pollingTaskId && primaryTaskIds.includes(pollingTaskId)) {
            debugDecision = 'node-newer-but-polling-match';
            debugResult = true;
          } else if (runtimeTaskId && nodeRuntimeTaskId === runtimeTaskId) {
            debugDecision = 'node-newer-but-runtime-match';
            debugResult = true;
          } else {
            debugDecision = 'node-newer';
          }
        } else {
          debugDecision = 'accepted';
          debugResult = true;
        }
      }
    }
  }
  return debugResult;
}

function cloneNodeWithAsyncTaskPatch(record = {}, node = {}, canvasId = '') {
  const nodeForCheck = { ...asObject(node), canvasId: trimString(node.canvasId) || trimString(canvasId) };
  if (!canRestoreAsyncTaskLoading(record, nodeForCheck)) return null;
  return { ...node, ...buildAsyncTaskLoadingPatch(record) };
}

export function applyAsyncTaskLoadingToCanvasData(canvasData = {}, options = {}) {
  const source = options.asyncTaskLoadingSource || options.source || '';
  const storage = options.asyncTaskStorage || options.storage;
  const records = loadAsyncTaskRecords({ ...options, storage }).filter((record) => isAsyncTaskRecordActive(record));
  const nodes = Array.isArray(canvasData?.nodes) ? canvasData.nodes : [];
  if (!records.length || !nodes.length) return canvasData;
  const recordsByNodeId = new Map();
  for (const record of records) {
    const nodeId = trimString(record.nodeId);
    if (!nodeId) continue;
    if (!recordsByNodeId.has(nodeId)) recordsByNodeId.set(nodeId, []);
    recordsByNodeId.get(nodeId).push(record);
  }
  let patchedCount = 0;
  const canvasId = trimString(canvasData?.id || canvasData?.canvasId);
  const patchedNodes = nodes.map((node) => {
    const nodeId = trimString(node?.id || node?.nodeId);
    const candidates = recordsByNodeId.get(nodeId) || [];
    for (const record of candidates) {
      const patched = cloneNodeWithAsyncTaskPatch(record, node, canvasId);
      if (patched) {
        patchedCount += 1;
        noteLoadingRecoveryDiag('hydrate-node-patched', { source, nodeId, status: record.status, runtimeTaskId: record.runtimeTaskId, remoteTaskId: record.remoteTaskId });
        return patched;
      }
    }
    return node;
  });
  if (!patchedCount) return canvasData;
  noteLoadingRecoveryDiag('hydrate-canvas-patched', { source, canvasId, patchedCount });
  return { ...canvasData, nodes: patchedNodes };
}

export function applyAsyncTaskLoadingToMultiCanvasData(multiData = {}, options = {}) {
  const canvases = Array.isArray(multiData?.canvases) ? multiData.canvases : [];
  if (!canvases.length) return multiData;
  let changed = false;
  const patchedCanvases = canvases.map((canvas) => {
    const patched = applyAsyncTaskLoadingToCanvasData(canvas, options);
    if (patched !== canvas) changed = true;
    return patched;
  });
  return changed ? { ...multiData, canvases: patchedCanvases } : multiData;
}

function patchCanvasHydrationTarget(target, options = {}) {
  if (!target || typeof target.init !== 'function') return false;
  if (target.__asyncTaskLoadingHydrationPatched) return true;
  const originalInit = target.init;
  target.init = function patchedAsyncTaskLoadingInit(multiData, initOptions = {}) {
    const patchedMultiData = applyAsyncTaskLoadingToMultiCanvasData(multiData, {
      ...options,
      asyncTaskLoadingSource: options.asyncTaskLoadingSource || 'canvas-hydration',
    });
    return originalInit.call(this, patchedMultiData, initOptions);
  };
  Object.defineProperty(target, '__asyncTaskLoadingHydrationPatched', { value: true, configurable: true });
  return true;
}

export function installAsyncTaskCanvasHydrationPatch(CanvasTabManagerTarget, options = {}) {
  const patchedObject = patchCanvasHydrationTarget(CanvasTabManagerTarget, options);
  const patchedPrototype = patchCanvasHydrationTarget(CanvasTabManagerTarget?.prototype, options);
  const installed = patchedObject || patchedPrototype;
  noteLoadingRecoveryDiag(installed ? 'hydrate-patch-installed' : 'hydrate-patch-skipped', {
    source: options.asyncTaskLoadingSource || 'canvas-hydration',
    patchedObject,
    patchedPrototype,
  });
  return installed;
}

export function restoreAsyncTaskLoadingRecords(records = [], options = {}) {
  const store = options.store || appStore;
  const restored = [];
  const inputRecords = Array.isArray(records) ? records : [];
  const activeRecords = inputRecords.filter((record) => isAsyncTaskRecordActive(record));
  const nodes = getNodes(store);
  noteLoadingRecoveryDiag('restore-attempt', {
    source: options.asyncTaskLoadingSource || options.source || '',
    totalRecords: inputRecords.length,
    activeRecords: activeRecords.length,
    nodeCount: Object.keys(nodes).length,
  });
  for (const record of inputRecords) {
    const nodeId = trimString(record.nodeId);
    const node = nodes[nodeId] || null;
    const active = isAsyncTaskRecordActive(record);
    const canRestore = canRestoreAsyncTaskLoading(record, node);
    const overlayRestored = canRestore ? restoreNodeLoadingOverlay(record) : false;
    noteLoadingRecoveryDiag('record-check', {
      nodeId,
      kind: record.kind,
      provider: record.provider,
      status: record.status,
      runtimeTaskId: record.runtimeTaskId,
      remoteTaskId: record.remoteTaskId,
      active,
      nodeFound: Boolean(node),
      overlayRestored,
      canRestore,
    });
    if (!canRestore) {
      continue;
    }
    const patch = buildAsyncTaskLoadingPatch(record);
    if (!updateNodeData(store, nodeId, patch)) {
      if (overlayRestored) restored.push({ runtimeTaskId: record.runtimeTaskId, remoteTaskId: record.remoteTaskId, nodeId, overlayRestored, record });
      continue;
    }
    const finalOverlayRestored = overlayRestored || restoreNodeLoadingOverlay(record);
    restored.push({ runtimeTaskId: record.runtimeTaskId, remoteTaskId: record.remoteTaskId, nodeId, overlayRestored: finalOverlayRestored, record });
  }
  noteLoadingRecoveryDiag('restore-result', {
    restoredCount: restored.length,
    overlayRestoredCount: restored.filter((item) => item.overlayRestored).length,
    pendingOverlayCount: restored.filter((item) => item.overlayRestored === false).length,
  });
  return restored;
}

function restorePendingLoadingOverlays(records = []) {
  const pending = (Array.isArray(records) ? records : [])
    .filter((item) => item && item.overlayRestored === false && item.record)
    .filter(Boolean);
  if (!pending.length) return [];
  noteLoadingRecoveryDiag('pending-overlay-retry', { pendingCount: pending.length });
  return pending.map((item) => {
    const overlayRestored = restoreNodeLoadingOverlay(item.record);
    if (overlayRestored) item.overlayRestored = true;
    return { ...item.record, overlayRestored };
  });
}

function subscribeStoreNodes(store, callback) {
  if (!store || typeof callback !== 'function') {
    noteLoadingRecoveryDiag('store-subscribe-skipped', { reason: !store ? 'no-store' : 'no-callback' });
    return null;
  }
  if (typeof store.subscribeSelector === 'function') {
    noteLoadingRecoveryDiag('store-subscribe-installed', { method: 'subscribeSelector' });
    return store.subscribeSelector(
      (state) => Object.keys(asObject(state?.nodes)).join('\n'),
      () => {
        noteLoadingRecoveryDiag('store-subscribe-fired', { method: 'subscribeSelector' });
        callback();
      },
    );
  }
  if (typeof store.subscribeRaw === 'function') {
    noteLoadingRecoveryDiag('store-subscribe-installed', { method: 'subscribeRaw' });
    return store.subscribeRaw(() => {
      noteLoadingRecoveryDiag('store-subscribe-fired', { method: 'subscribeRaw' });
      callback();
    });
  }
  if (typeof store.subscribe === 'function') {
    noteLoadingRecoveryDiag('store-subscribe-installed', { method: 'subscribe' });
    return store.subscribe(() => {
      noteLoadingRecoveryDiag('store-subscribe-fired', { method: 'subscribe' });
      callback();
    });
  }
  noteLoadingRecoveryDiag('store-subscribe-skipped', { reason: 'no-supported-api' });
  return null;
}

function scheduleRun(callback) {
  if (typeof callback !== 'function') return null;
  if (typeof globalThis.requestAnimationFrame === 'function') {
    const frame = globalThis.requestAnimationFrame(() => callback());
    return () => globalThis.cancelAnimationFrame?.(frame);
  }
  const timer = setTimeout(callback, 0);
  if (typeof timer?.unref === 'function') timer.unref();
  return () => clearTimeout(timer);
}

function observeLoadingDomMounts(callback, options = {}) {
  if (typeof callback !== 'function') return null;
  const root = options.root || globalThis.document?.body;
  const Observer = globalThis.MutationObserver;
  if (!root || typeof Observer !== 'function') return null;
  let scheduledCancel = null;
  const schedule = () => {
    if (scheduledCancel) return;
    scheduledCancel = scheduleRun(() => {
      scheduledCancel = null;
      callback();
    });
  };
  const observer = new Observer((mutations = []) => {
    if (!Array.isArray(mutations) || mutations.some((mutation) => mutation?.addedNodes?.length)) {
      noteLoadingRecoveryDiag('dom-observer-fired', { mutations: Array.isArray(mutations) ? mutations.length : 0 });
      schedule();
    }
  });
  try {
    observer.observe(root, { childList: true, subtree: true });
    noteLoadingRecoveryDiag('dom-observer-installed', { hasRoot: Boolean(root) });
  } catch (error) {
    noteLoadingRecoveryDiag('dom-observer-skipped', { reason: error?.message || 'observe-failed' });
    return null;
  }
  return () => {
    try { scheduledCancel?.(); } catch {}
    scheduledCancel = null;
    try { observer.disconnect(); } catch {}
  };
}

function startFastLoadingRecovery(callback, options = {}) {
  if (typeof callback !== 'function') return null;
  const intervalMs = Math.max(16, Number(options.asyncTaskLoadingOverlayIntervalMs ?? DEFAULT_LOADING_OVERLAY_INTERVAL_MS) || DEFAULT_LOADING_OVERLAY_INTERVAL_MS);
  const durationMs = Math.max(0, Number(options.asyncTaskLoadingOverlayFastMs ?? DEFAULT_LOADING_OVERLAY_FAST_MS) || 0);
  if (durationMs <= 0) return null;
  const startedAt = Date.now();
  noteLoadingRecoveryDiag('fast-recovery-started', { intervalMs, durationMs });
  const timer = setInterval(() => {
    noteLoadingRecoveryDiag('fast-recovery-tick', { elapsedMs: Date.now() - startedAt });
    callback();
    if (Date.now() - startedAt >= durationMs) {
      noteLoadingRecoveryDiag('fast-recovery-ended', { elapsedMs: Date.now() - startedAt });
      clearInterval(timer);
    }
  }, intervalMs);
  if (typeof timer?.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export function restoreAsyncTaskLoadingFromStore(options = {}) {
  const store = options.store || appStore;
  const storage = options.asyncTaskStorage || options.storage;
  const records = loadAsyncTaskRecords({ ...options, storage });
  noteLoadingRecoveryDiag('records-loaded', {
    source: options.asyncTaskLoadingSource || options.source || '',
    totalRecords: Array.isArray(records) ? records.length : 0,
    activeRecords: Array.isArray(records) ? records.filter((record) => isAsyncTaskRecordActive(record)).length : 0,
  });
  return restoreAsyncTaskLoadingRecords(records, { ...options, store });
}

export function installAsyncTaskLoadingRecovery(options = {}) {
  const source = options.asyncTaskLoadingSource || options.source || 'unknown';
  if (installedAsyncTaskLoadingRecovery) {
    noteLoadingRecoveryDiag('install-reused', {
      requestedSource: source,
      installedSource: installedAsyncTaskLoadingRecovery.source || '',
      installedAtDt: installedAsyncTaskLoadingRecovery.installedAtDt,
    });
    return installedAsyncTaskLoadingRecovery;
  }
  const store = options.store || appStore;
  const storage = options.asyncTaskStorage || options.storage;
  const delays = Array.isArray(options.asyncTaskLoadingRetryDelays) ? options.asyncTaskLoadingRetryDelays : DEFAULT_LOADING_RETRY_DELAYS;
  const maxWatchMs = Math.max(0, Number(options.asyncTaskLoadingWatchMs ?? DEFAULT_LOADING_WATCH_MS) || 0);
  const installedAtDt = Math.round((getNowMs() - getLoadingRecoveryDiag().startedAt) * 10) / 10;
  noteLoadingRecoveryDiag('install-start', {
    source,
    delays,
    maxWatchMs,
    hasStore: Boolean(store),
    storeKeys: store && typeof store === 'object' ? Object.keys(store).slice(0, 40) : [],
    hasGetState: typeof store?.getState === 'function',
    hasGetStateRaw: typeof store?.getStateRaw === 'function',
    hasUpdateNodeData: typeof store?.updateNodeData === 'function',
  });
  let stopped = false;
  let latest = [];

  const run = (reason = 'run') => {
    if (stopped) return latest;
    noteLoadingRecoveryDiag('run-start', { source, reason });
    latest = restoreAsyncTaskLoadingFromStore({ ...options, store, storage, asyncTaskLoadingSource: source, source });
    restorePendingLoadingOverlays(latest);
    noteLoadingRecoveryDiag('run-end', { source, reason, restoredCount: latest.length });
    return latest;
  };

  const runFastRecovery = () => {
    if (stopped) return latest;
    return run('fast-recovery');
  };

  for (const delay of delays) {
    const ms = Math.max(0, Number(delay) || 0);
    if (ms <= 0) {
      run('initial');
      continue;
    }
    const timer = setTimeout(() => run(`retry-${ms}`), ms);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  const unsubscribe = subscribeStoreNodes(store, () => run('store-subscribe'));
  const disconnectDomObserver = observeLoadingDomMounts(() => run('dom-observer'), options);
  const stopFastLoadingRecovery = startFastLoadingRecovery(runFastRecovery, options);
  const stopWatch = () => {
    stopped = true;
    noteLoadingRecoveryDiag('install-stopped', { source });
    try { unsubscribe?.(); } catch {}
    try { disconnectDomObserver?.(); } catch {}
    try { stopFastLoadingRecovery?.(); } catch {}
    if (installedAsyncTaskLoadingRecovery?.stop === stopWatch) installedAsyncTaskLoadingRecovery = null;
  };
  if ((unsubscribe || disconnectDomObserver || stopFastLoadingRecovery) && maxWatchMs > 0) {
    const timer = setTimeout(stopWatch, maxWatchMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  installedAsyncTaskLoadingRecovery = {
    restored: latest,
    source,
    installedAtDt,
    stop: stopWatch,
    dump: () => globalThis[ASYNC_LOADING_DUMP_KEY]?.(),
  };
  noteLoadingRecoveryDiag('install-ready', { source, restoredCount: latest.length });
  return installedAsyncTaskLoadingRecovery;
}

export const __test__ = {
  collectPrimaryNodeTaskIds,
  getNodeStartedAt,
  isSameCanvas,
  subscribeStoreNodes,
};
