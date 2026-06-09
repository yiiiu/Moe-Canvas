import {
  cancelTask as cancelGenerationTask,
  resumeTask as resumeGenerationTask,
  submitTask as submitGenerationTask,
} from './generationTaskRuntime.js';
import appStore from './stores/appStore.js';
import { buildGenerationCancelledPatch } from './generationTaskLifecycle.js';
import { upsertUnifiedTaskToTaskCenter } from './unifiedTaskCenterAdapter.js';
import { upsertAsyncTaskRecord } from './asyncTaskStore.js';
import { cancelRunningHubImageTask } from '../../api/aiImageApi.js';
import { cancelRunningHubVideoTask } from '../../api/aiVideoApi.js';
import { cancelRunningHubAudioTask } from '../../api/aiAudioApi.js';
import { ensureConfig, getProviderConfig } from '../../api/configApi.js';

const TASK_CENTER_IMAGE_SLOW_PROVIDERS = new Set(['runninghub', 'runninghubwf', 'runninghub-workflow', 'runninghub_workflow', 'dreamina', 'apimart', 'grsai']);
const TASK_CENTER_IMAGE_LARGE_SIZE_PATTERN = /(?:^|[^a-z0-9])(?:hd|uhd|2k|3k|4k|2048|4096)(?:[^a-z0-9]|$)/i;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function countList(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function isImageTaskSpec(spec = {}, node = {}) {
  const taskSpec = asObject(spec);
  const nodeData = asObject(node);
  const kindText = normalizeLower(taskSpec.kind || taskSpec.taskKind || taskSpec.taskType || nodeData.taskKind || nodeData.asyncTaskKind || nodeData.type);
  return kindText.includes('image');
}

function shouldSyncImageTaskToTaskCenter(spec = {}, node = {}) {
  const taskSpec = asObject(spec);
  const nodeData = asObject(node);
  const payload = asObject(taskSpec.payload);
  const generationParams = asObject(payload.generationParams || nodeData.generationParams);

  if (taskSpec.taskCenterVisibility === 'hidden') return false;
  if (taskSpec.taskCenterVisibility === 'visible' || taskSpec.forceTaskCenter === true) return true;
  if (taskSpec.async === true || taskSpec.resumable === true) return true;

  const adapterType = normalizeLower(taskSpec.adapterType || nodeData.taskAdapterType);
  if (adapterType === 'workflow') return true;

  const provider = normalizeLower(taskSpec.provider || payload.provider || nodeData.provider || nodeData.asyncTaskProvider);
  if (TASK_CENTER_IMAGE_SLOW_PROVIDERS.has(provider)) return true;

  const batchSize = firstFiniteNumber(
    taskSpec.batchSize,
    payload.batchSize,
    generationParams.batchSize,
    nodeData.batchSize,
  );
  if (batchSize !== null && batchSize > 1) return true;

  const inputCount = Math.max(
    countList(payload.inputUrls),
    countList(payload.inputImageUrls),
    countList(payload.imageUrls),
    countList(payload.inputRefs),
    countList(payload.assetInputRefs),
    countList(payload.providerAssetRefs),
    countList(nodeData.inputRefs),
    countList(nodeData.assetInputRefs),
    countList(nodeData.providerAssetRefs),
  );
  if (inputCount > 1) return true;

  const sizeText = [
    taskSpec.imageSize,
    payload.imageSize,
    payload.size,
    payload.resolution,
    generationParams.imageSize,
    generationParams.size,
    generationParams.resolution,
    nodeData.imageSize,
    nodeData.resolution,
  ].map((value) => String(value || '')).join(' ');
  if (TASK_CENTER_IMAGE_LARGE_SIZE_PATTERN.test(sizeText)) return true;

  return false;
}

function shouldSyncGenerationTaskToTaskCenter({ spec = {}, node = {} } = {}) {
  if (!isImageTaskSpec(spec, node)) return true;
  return shouldSyncImageTaskToTaskCenter(spec, node);
}

function getStoreState(store) {
  if (!store) return {};
  if (typeof store.getStateRaw === 'function') return asObject(store.getStateRaw());
  if (typeof store.getState === 'function') return asObject(store.getState());
  return asObject(store.state);
}

function resolveTargetNodeId(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  return String(
    taskResult.targetNodeId
      || taskSpec.targetNodeId
      || taskSpec.sourceNodeId
      || ''
  ).trim();
}

function resolveNode(store, nodeId) {
  const state = getStoreState(store);
  return asObject(state.nodes)?.[nodeId] || null;
}

function resolveNow(options = {}) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function resolveManager(options = {}) {
  return options.taskCenterManager || globalThis.window?.__aiCanvasTaskCenterManager || null;
}

function resolveStore(options = {}) {
  return options.store || appStore || null;
}

function getNodeStartedAt(node = {}) {
  return firstFiniteNumber(
    node.generationStartTime,
    node.rhTaskStartedAt,
    node.asyncTaskStartedAt,
    node.dreaminaTaskStartedAt,
  ) || 0;
}

function collectNodeRemoteTaskIds(node = {}) {
  return [
    node.asyncTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.remoteTaskId,
    node.taskId,
    node.generationTaskId,
  ].map(trimString).filter(Boolean);
}

function collectPrimaryNodeRemoteTaskIds(node = {}) {
  return [
    node.asyncTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
    node.generationTaskId,
  ].map(trimString).filter(Boolean);
}

function shouldClearGenerationNodeForTask(node = {}, spec = {}, result = {}) {
  const remoteTaskId = resolveRemoteTaskId(spec, result);
  const primaryTaskIds = collectPrimaryNodeRemoteTaskIds(node);
  if (remoteTaskId && primaryTaskIds.length > 0) return primaryTaskIds.includes(remoteTaskId);
  const nodeRemoteTaskIds = collectNodeRemoteTaskIds(node);
  if (remoteTaskId && nodeRemoteTaskIds.length > 0) return nodeRemoteTaskIds.includes(remoteTaskId);
  return node.isGenerating === true || normalizeLower(node.jobStatus) === 'loading';
}

function snapshotGenerationNodeRunningState(node = {}) {
  return {
    isGenerating: node.isGenerating,
    jobStatus: node.jobStatus,
    jobError: node.jobError,
    taskCancellable: node.taskCancellable,
    asyncTaskId: node.asyncTaskId,
    asyncTaskStatus: node.asyncTaskStatus,
    asyncTaskRecovering: node.asyncTaskRecovering,
    rhTaskId: node.rhTaskId,
    rhTaskStatus: node.rhTaskStatus,
    rhTaskRecovering: node.rhTaskRecovering,
    dreaminaSubmitId: node.dreaminaSubmitId,
    dreaminaTaskStatus: node.dreaminaTaskStatus,
    dreaminaTaskPhase: node.dreaminaTaskPhase,
    dreaminaTaskRecovering: node.dreaminaTaskRecovering,
    remoteTaskId: node.remoteTaskId,
    taskId: node.taskId,
    generationTaskId: node.generationTaskId,
    generationStartTime: node.generationStartTime,
  };
}

function restoreGenerationNodeRunningStateIfStale(nodeId = '', options = {}, spec = {}, result = {}, snapshot = null) {
  const targetNodeId = trimString(nodeId);
  const store = resolveStore(options);
  if (!targetNodeId || !snapshot || typeof store?.updateNodeData !== 'function') return;
  const currentNode = resolveNode(store, targetNodeId) || {};
  if (shouldClearGenerationNodeForTask(snapshot, spec, result)) return;
  if (shouldClearGenerationNodeForTask(currentNode, spec, result)) return;
  const snapshotRemoteTaskIds = collectNodeRemoteTaskIds(snapshot);
  if (snapshotRemoteTaskIds.length > 0) {
    const currentRemoteTaskIds = collectNodeRemoteTaskIds(currentNode);
    if (!snapshotRemoteTaskIds.some((taskId) => currentRemoteTaskIds.includes(taskId))) return;
  }
  store.updateNodeData(targetNodeId, snapshot);
}

function clearGenerationNodeCancelledState(nodeId = '', options = {}, spec = {}, result = {}) {
  const targetNodeId = trimString(nodeId);
  const store = resolveStore(options);
  if (!targetNodeId || typeof store?.updateNodeData !== 'function') return;
  const node = resolveNode(store, targetNodeId) || {};
  if (!shouldClearGenerationNodeForTask(node, spec, result)) return;
  const startedAt = getNodeStartedAt(node);
  store.updateNodeData(targetNodeId, {
    ...buildGenerationCancelledPatch({ startedAt }),
    taskCancellable: false,
    rhTaskStatus: 'cancelled',
    rhTaskRecovering: false,
    asyncTaskStatus: 'cancelled',
    asyncTaskRecovering: false,
    dreaminaTaskStatus: 'cancelled',
    dreaminaTaskPhase: 'cancelled',
    dreaminaTaskRecovering: false,
  });
}

function markTaskCenterGenerationCancelled(nodeId = '', options = {}, spec = {}, result = {}) {
  const targetNodeId = trimString(nodeId);
  if (!targetNodeId) return null;
  return syncGenerationTaskToTaskCenter({
    spec: { ...asObject(spec), targetNodeId, id: `generation:${targetNodeId}` },
    options,
    result: { ...asObject(result), targetNodeId },
    status: 'cancelled',
    error: null,
  });
}

function resolveRemoteTaskId(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const taskMeta = asObject(taskResult.taskMeta);
  const nestedResult = asObject(taskResult.result);
  return trimString(
    taskResult.taskId
      || taskResult.task_id
      || taskResult.id
      || taskMeta.taskId
      || taskMeta.task_id
      || taskMeta.id
      || nestedResult.taskId
      || nestedResult.task_id
      || nestedResult.id
      || taskSpec.taskId
      || taskSpec.remoteTaskId
      || taskSpec.asyncTaskId
  );
}

function buildGenerationRecoverySpec({ spec = {}, result = {}, nodeId = '' } = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const remoteTaskId = resolveRemoteTaskId(taskSpec, taskResult);
  const targetNodeId = trimString(nodeId || resolveTargetNodeId(taskSpec, taskResult));
  if (!remoteTaskId || !targetNodeId) return null;
  const payload = asObject(taskSpec.payload);
  const taskMeta = asObject(taskResult.taskMeta || taskSpec.taskMeta);
  return {
    kind: 'generation',
    taskType: trimString(taskSpec.taskType || taskSpec.taskKind || taskSpec.kind),
    provider: trimString(taskSpec.provider || payload.provider || taskMeta.provider),
    adapterType: trimString(taskSpec.adapterType),
    modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
    executionId: trimString(taskSpec.executionId),
    sourceNodeId: trimString(taskSpec.sourceNodeId),
    targetNodeId,
    taskId: remoteTaskId,
    startedAt: firstFiniteNumber(taskSpec.startedAt, taskResult.startedAt) || 0,
    resumable: taskSpec.resumable !== false,
    cancellable: taskSpec.cancellable !== false,
    taskMeta,
    payload,
  };
}

function resolveAsyncTaskRecordKind(recoverySpec = {}) {
  const text = normalizeLower(recoverySpec.taskType || recoverySpec.kind);
  if (text.includes('image')) return 'image';
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  if (text.includes('media')) return 'media';
  return 'provider_async';
}

function persistAsyncTaskIdRecord({ spec = {}, options = {}, result = {}, status = 'polling' } = {}) {
  const recoverySpec = buildGenerationRecoverySpec({ spec, result });
  if (!recoverySpec) return null;
  const now = resolveNow(options);
  const kind = resolveAsyncTaskRecordKind(recoverySpec);
  const store = resolveStore(options);
  const node = resolveNode(store, recoverySpec.targetNodeId) || {};
  const record = upsertAsyncTaskRecord({
    remoteTaskId: recoverySpec.taskId,
    kind,
    provider: recoverySpec.provider || recoverySpec.payload?.provider,
    modelId: recoverySpec.modelId,
    nodeId: recoverySpec.targetNodeId,
    canvasId: trimString(spec.canvasId || result.canvasId || node.canvasId),
    sourceNodeId: recoverySpec.sourceNodeId,
    status: status || result.status || 'polling',
    canCancel: recoverySpec.cancellable !== false,
    canResume: recoverySpec.resumable !== false,
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
    createdAt: firstFiniteNumber(recoverySpec.startedAt, spec.createdAt, result.createdAt) || now,
    updatedAt: firstFiniteNumber(result.updatedAt, spec.updatedAt) || now,
  }, {
    ...options,
    storage: options.asyncTaskStorage || options.storage,
    now,
  });
  if (record && typeof store?.updateNodeData === 'function') {
    store.updateNodeData(recoverySpec.targetNodeId, {
      asyncRuntimeTaskId: record.runtimeTaskId,
      remoteTaskId: record.remoteTaskId,
      taskProvider: record.provider,
      taskModelId: record.modelId,
      taskType: trimString(recoverySpec.taskType),
      taskAdapterType: trimString(recoverySpec.adapterType) || 'modelApi',
      taskResumable: record.canResume,
    });
  }
  return record;
}

function resolveRestoredTaskType(spec = {}) {
  const taskSpec = asObject(spec);
  const text = normalizeLower(taskSpec.taskType || taskSpec.type || taskSpec.kind);
  if (text.includes('image')) return 'image';
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  return text;
}

function shouldUseRunningHubCancel(provider) {
  const value = normalizeLower(provider);
  return value === 'runninghub' || value === 'runninghubwf' || value === 'runninghub-workflow' || value === 'runninghub_workflow';
}

async function cancelRunningHubRestoredGenerationTask({ taskId = '', spec = {}, options = {} } = {}) {
  const taskSpec = asObject(spec);
  const remoteTaskId = trimString(taskId || taskSpec.taskId || taskSpec.remoteTaskId || taskSpec.asyncTaskId);
  if (!remoteTaskId || !shouldUseRunningHubCancel(taskSpec.provider || taskSpec.payload?.provider)) return null;
  if (typeof options.restoredCancelTaskFn === 'function') {
    return options.restoredCancelTaskFn({ taskId: remoteTaskId, spec: taskSpec });
  }
  await ensureConfig();
  const providerConfig = getProviderConfig(taskSpec.provider || 'runninghub');
  const apiKey = trimString(providerConfig?.modelApiKey || providerConfig?.apiKey);
  const taskType = resolveRestoredTaskType(taskSpec);
  if (taskType === 'image') return cancelRunningHubImageTask({ apiKey, taskId: remoteTaskId });
  if (taskType === 'audio') return cancelRunningHubAudioTask({ apiKey, taskId: remoteTaskId });
  return cancelRunningHubVideoTask({ apiKey, taskId: remoteTaskId });
}

function attachRestoredCancelSpec(spec = {}, options = {}) {
  const taskSpec = asObject(spec);
  if (!taskSpec.cancellable || !shouldUseRunningHubCancel(taskSpec.provider || taskSpec.payload?.provider)) return taskSpec;
  return {
    ...taskSpec,
    cancel: ({ taskId } = {}) => cancelRunningHubRestoredGenerationTask({ taskId, spec: taskSpec, options }),
  };
}

function isAsyncImageRecoverySpec(spec = {}, result = {}) {
  const recoverySpec = buildGenerationRecoverySpec({ spec, result });
  if (!recoverySpec) return false;
  const taskType = normalizeLower(recoverySpec.taskType);
  if (taskType && !taskType.includes('image')) return false;
  const provider = normalizeLower(recoverySpec.provider || recoverySpec.payload?.provider);
  return Boolean(provider && provider !== 'runninghub' && provider !== 'runninghubwf' && provider !== 'dreamina');
}

function persistGenerationNodeRecoveryState({ spec = {}, options = {}, result = {}, status = 'polling' } = {}) {
  const recoverySpec = buildGenerationRecoverySpec({ spec, result });
  if (!recoverySpec || !isAsyncImageRecoverySpec(spec, result)) return;
  const store = resolveStore(options);
  if (typeof store?.updateNodeData !== 'function') return;
  const taskStatus = normalizeLower(status || result.status || 'polling') || 'polling';
  const startedAt = firstFiniteNumber(recoverySpec.startedAt, Date.now()) || Date.now();
  store.updateNodeData(recoverySpec.targetNodeId, {
    isGenerating: true,
    jobStatus: 'loading',
    jobError: null,
    generationStartTime: startedAt,
    taskTrigger: trimString(spec.trigger),
    taskType: trimString(recoverySpec.taskType),
    taskProvider: trimString(recoverySpec.provider),
    taskAdapterType: trimString(recoverySpec.adapterType) || 'modelApi',
    taskModelId: trimString(recoverySpec.modelId),
    taskExecutionId: trimString(recoverySpec.executionId),
    taskCancellable: recoverySpec.cancellable !== false,
    taskResumable: recoverySpec.resumable !== false,
    asyncTaskId: trimString(recoverySpec.taskId),
    asyncTaskProvider: trimString(recoverySpec.provider || recoverySpec.payload?.provider),
    asyncTaskKind: 'image',
    asyncTaskStatus: ['success', 'complete', 'completed', 'done', 'failed', 'cancelled', 'canceled'].includes(taskStatus) ? taskStatus : 'running',
    asyncTaskRecovering: false,
    asyncTaskStartedAt: startedAt,
  });
}

function syncGenerationTaskRecovery({ spec = {}, options = {}, result = {}, status = 'polling' } = {}) {
  persistAsyncTaskIdRecord({ spec, options, result, status });
  persistGenerationNodeRecoveryState({ spec, options, result, status });
  const task = syncGenerationTaskToTaskCenter({ spec, options, result, status });
  return task;
}

function wrapSpecForTaskCenterRecovery(spec = {}, options = {}) {
  const originalSubmit = asObject(spec).submit;
  if (typeof originalSubmit !== 'function') return spec;
  return {
    ...spec,
    submit: async (payload, runtimeOptions = {}) => {
      const nextOptions = {
        ...runtimeOptions,
        onTaskId: (taskId) => {
          if (typeof runtimeOptions.onTaskId === 'function') runtimeOptions.onTaskId(taskId);
          syncGenerationTaskRecovery({
            spec: { ...spec, taskId },
            options,
            result: { taskId, targetNodeId: spec.targetNodeId },
          });
        },
        onTaskMeta: (taskMeta) => {
          if (typeof runtimeOptions.onTaskMeta === 'function') runtimeOptions.onTaskMeta(taskMeta);
          const meta = asObject(taskMeta);
          syncGenerationTaskRecovery({
            spec: { ...spec, taskId: meta.taskId || spec.taskId },
            options,
            result: { taskId: meta.taskId, taskMeta: meta, targetNodeId: spec.targetNodeId },
          });
        },
      };
      return originalSubmit(payload, nextOptions);
    },
  };
}

function resolveTaskCenterStatus(status = '') {
  const value = normalizeLower(status);
  if (value === 'submitted' || value === 'pending') return 'polling';
  return status;
}

export function syncGenerationTaskToTaskCenter({ spec = {}, options = {}, result = {}, status = '', error = null } = {}) {
  const manager = resolveManager(options);
  if (!manager || typeof manager.upsertTask !== 'function') return null;

  const nodeId = resolveTargetNodeId(spec, result);
  const node = resolveNode(options.store, nodeId) || { id: nodeId };
  if (!shouldSyncGenerationTaskToTaskCenter({ spec, node })) return null;

  const taskSpec = nodeId ? { ...asObject(spec), id: `generation:${nodeId}` } : spec;
  const now = resolveNow(options);
  const createdAt = firstFiniteNumber(taskSpec.startedAt, result.startedAt, taskSpec.createdAt, result.createdAt) || now;

  return upsertUnifiedTaskToTaskCenter({
    spec: taskSpec,
    node,
    nodeId,
    status: resolveTaskCenterStatus(status || result.status),
    error,
    now,
    createdAt,
    updatedAt: firstFiniteNumber(result.updatedAt, taskSpec.updatedAt) || now,
    taskCenterExtras: {
      recoverySpec: buildGenerationRecoverySpec({ spec: taskSpec, result, nodeId }),
    },
  }, manager);
}

export { shouldSyncImageTaskToTaskCenter, shouldSyncGenerationTaskToTaskCenter };

export async function submitTask(spec, options = {}) {
  const taskSpec = wrapSpecForTaskCenterRecovery(spec, options);
  syncGenerationTaskToTaskCenter({ spec: taskSpec, options, status: 'running' });
  const result = await submitGenerationTask(taskSpec, options);
  persistAsyncTaskIdRecord({
    spec: taskSpec,
    options,
    result,
    status: result?.status || 'polling',
  });
  syncGenerationTaskToTaskCenter({
    spec: taskSpec,
    options,
    result,
    status: result?.status,
    error: result?.error,
  });
  return result;
}

export async function resumeTask(spec, options = {}) {
  const taskSpec = attachRestoredCancelSpec(spec, options);
  syncGenerationTaskToTaskCenter({ spec: taskSpec, options, status: 'polling' });
  const result = await resumeGenerationTask(taskSpec, options);
  syncGenerationTaskToTaskCenter({
    spec: taskSpec,
    options,
    result,
    status: result?.status,
    error: result?.error,
  });
  return result;
}

function resolveTaskCenterRecoverySpec(targetNodeId, options = {}) {
  const manager = resolveManager(options);
  const task = manager?.tasks?.get?.(`generation:${targetNodeId}`);
  return asObject(task?.recoverySpec || task?.unifiedTask?.recoverySpec);
}

export async function cancelTask(targetNodeId, options = {}) {
  const nodeId = trimString(targetNodeId?.targetNodeId || targetNodeId?.nodeId || targetNodeId?.id || targetNodeId);
  const nodeBeforeCancel = nodeId ? snapshotGenerationNodeRunningState(resolveNode(resolveStore(options), nodeId) || {}) : null;
  const recoverySpec = resolveTaskCenterRecoverySpec(nodeId, options);
  const recoveryCancelSpec = recoverySpec.taskId ? attachRestoredCancelSpec({
    ...recoverySpec,
    targetNodeId: recoverySpec.targetNodeId || nodeId,
    taskId: recoverySpec.taskId,
    cancellable: recoverySpec.cancellable !== false,
  }, options) : null;
  const cancelOptions = recoveryCancelSpec ? {
    ...options,
    spec: recoveryCancelSpec,
    taskId: recoveryCancelSpec.taskId,
    cancellable: recoveryCancelSpec.cancellable !== false,
    cancel: recoveryCancelSpec.cancel,
  } : options;
  const effectiveCancelSpec = recoveryCancelSpec || asObject(options.spec);
  const optimisticCancelResult = {
    taskId: recoveryCancelSpec?.taskId || options.taskId || effectiveCancelSpec.taskId,
  };
  clearGenerationNodeCancelledState(nodeId || targetNodeId, options, effectiveCancelSpec, optimisticCancelResult);
  markTaskCenterGenerationCancelled(nodeId || targetNodeId, options, effectiveCancelSpec, optimisticCancelResult);
  const result = await cancelGenerationTask(nodeId || targetNodeId, cancelOptions);
  restoreGenerationNodeRunningStateIfStale(nodeId || targetNodeId, options, effectiveCancelSpec, result, nodeBeforeCancel);
  clearGenerationNodeCancelledState(nodeId || targetNodeId, options, effectiveCancelSpec, result);
  syncGenerationTaskToTaskCenter({
    spec: { ...effectiveCancelSpec, targetNodeId: nodeId || targetNodeId },
    options,
    result: { ...result, targetNodeId: nodeId || targetNodeId },
    status: 'cancelled',
    error: null,
  });
  return result;
}