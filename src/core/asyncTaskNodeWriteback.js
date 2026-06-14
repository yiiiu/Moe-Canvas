import { buildGenerationNodeStateProjection } from './generationTaskNodeStateProjection.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function getStoreState(store) {
  if (!store) return {};
  if (typeof store.getStateRaw === 'function') return asObject(store.getStateRaw());
  if (typeof store.getState === 'function') return asObject(store.getState());
  return asObject(store.state);
}

function getStoreNodes(store) {
  const nodes = getStoreState(store).nodes;
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

function normalizeTaskKind(kind) {
  const value = normalizeLower(kind);
  if (value.includes('image')) return 'image-generation';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  return value || 'provider_async';
}

function normalizePhase(phase, task = {}) {
  const value = normalizeLower(phase || task.status);
  if (['complete', 'completed', 'done', 'finished', 'succeeded'].includes(value)) return 'success';
  if (['fail', 'failure', 'errored', 'error'].includes(value)) return 'failed';
  if (value === 'canceled') return 'cancelled';
  return value || 'running';
}

function formatReadableError(error) {
  if (typeof error === 'string') return error.trim();
  if (!error) return '';
  if (error instanceof Error && error.message) return String(error.message).trim();
  if (typeof error === 'object' && !Array.isArray(error)) {
    const candidates = [
      error.message,
      error.error_message,
      error.errorMessage,
      error.detail,
      error.details,
      error.reason,
      error.description,
      error.error,
      error.response?.data,
      error.response?.body,
      error.data,
      error.body,
    ];
    for (const candidate of candidates) {
      const text = formatReadableError(candidate);
      if (text) return text;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {}
    return '';
  }
  return String(error || '').trim();
}

function resolveNodeCanvasId(node = {}) {
  return trimString(node.canvasId || node.data?.canvasId);
}

function resolveTaskCanvasId(task = {}) {
  return trimString(task.canvasId || task.recoverySpec?.canvasId || task.payload?.canvasId || task.unifiedTask?.canvasId);
}

function buildProjectionTask(task = {}, phase = '') {
  const normalizedKind = normalizeTaskKind(task.kind || task.taskType || task.unifiedTask?.kind);
  const readableError = formatReadableError(task.error || task.unifiedTask?.error);
  return {
    ...task,
    status: phase,
    error: readableError || task.error,
    kind: normalizedKind,
    startedAt: task.startedAt || task.createdAt,
    recoverySpec: {
      ...asObject(task.recoverySpec),
      kind: 'generation',
      taskType: normalizedKind,
      provider: task.provider || task.recoverySpec?.provider,
      recoveryMode: task.recoveryMode || task.recoverySpec?.recoveryMode,
      startedAt: task.startedAt || task.recoverySpec?.startedAt || task.createdAt,
      runtimeTaskId: task.runtimeTaskId || task.recoverySpec?.runtimeTaskId,
      clientTaskId: task.clientTaskId || task.recoverySpec?.clientTaskId,
      taskId: task.taskId || task.pollingTaskId || task.asyncTaskId || task.recoverySpec?.taskId,
    },
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      status: phase,
      kind: normalizedKind === 'image-generation' ? 'image' : normalizedKind,
      error: phase === 'failed' ? task.error || task.unifiedTask.error : task.unifiedTask.error,
    } : task.unifiedTask,
  };
}

function buildBackfillPatch({ phase = '', task = {}, resultPatch = {} } = {}) {
  const normalizedPhase = normalizePhase(phase, task);
  return buildGenerationNodeStateProjection({
    phase: normalizedPhase,
    task: buildProjectionTask(task, normalizedPhase),
    resultPatch,
  });
}

export function writeAsyncTaskNodeBackfill({ store, phase = '', task = {}, resultPatch = {} } = {}) {
  const nodeId = trimString(task.nodeId || task.targetNodeId || task.recoverySpec?.targetNodeId || task.unifiedTask?.nodeId);
  if (!nodeId) return { ok: false, reason: 'missing-node-id' };
  if (!store || typeof store.updateNodeData !== 'function') return { ok: false, reason: 'missing-store-writer', nodeId };

  const node = asObject(getStoreNodes(store)[nodeId]);
  if (!Object.keys(node).length) return { ok: false, reason: 'node-not-found', nodeId };

  const taskCanvasId = resolveTaskCanvasId(task);
  const nodeCanvasId = resolveNodeCanvasId(node);
  if (taskCanvasId && nodeCanvasId && taskCanvasId !== nodeCanvasId) {
    return { ok: false, reason: 'canvas-mismatch', nodeId, taskCanvasId, nodeCanvasId };
  }

  const patch = buildBackfillPatch({ phase, task, resultPatch });
  try {
    store.updateNodeData(nodeId, patch);
    return { ok: true, reason: 'updated', nodeId, patch };
  } catch (error) {
    return { ok: false, reason: 'update-failed', nodeId, error };
  }
}

export const __test__ = {
  buildBackfillPatch,
  getStoreNodes,
};