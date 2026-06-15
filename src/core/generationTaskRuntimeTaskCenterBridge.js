import {
  cancelTask as cancelGenerationTask,
  resumeTask as resumeGenerationTask,
  submitTask as submitGenerationTask,
} from './generationTaskRuntime.js';
import appStore from './stores/appStore.js';
import { buildGenerationCancelledPatch } from './generationTaskLifecycle.js';
import { buildGenerationNodeStateProjection } from './generationTaskNodeStateProjection.js';
import { upsertUnifiedTaskToTaskCenter } from './unifiedTaskCenterAdapter.js';
import {
  createAsyncRuntimeTaskId,
  isAsyncTaskRecordActive,
  loadAsyncTaskRecords,
  upsertAsyncTaskRecord,
} from './asyncTaskStore.js';
import { resolveAsyncTaskRecoveryCapability } from './asyncTaskRecoveryCapabilities.js';
import { cancelRunningHubImageTask } from '../../api/aiImageApi.js';
import { cancelRunningHubVideoTask } from '../../api/aiVideoApi.js';
import { cancelRunningHubAudioTask } from '../../api/aiAudioApi.js';
import { ensureConfig, getProviderConfig } from '../../api/configApi.js';

const TASK_CENTER_IMAGE_SLOW_PROVIDERS = new Set(['runninghub', 'runninghubwf', 'runninghub-workflow', 'runninghub_workflow', 'dreamina', 'apimart', 'grsai']);
const TASK_CENTER_IMAGE_LARGE_SIZE_PATTERN = /(?:^|[^a-z0-9])(?:hd|uhd|2k|3k|4k|2048|4096)(?:[^a-z0-9]|$)/i;
const GENERATION_TERMINAL_STATUSES = new Set(['success', 'complete', 'completed', 'done', 'failed', 'cancelled', 'canceled', 'interrupted']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function stripLocalProxyRemotePollingOptions(value = {}) {
  const output = { ...asObject(value) };
  delete output.taskPolling;
  delete output.pollingSpec;
  delete output.pollUrlTemplate;
  delete output.pollUrl;
  delete output.pollMethod;
  delete output.pollingTaskId;
  delete output.queryableTaskId;
  delete output.recoveryTaskId;
  return output;
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

function resolveCanvasId(store, spec = {}, payload = {}, node = {}) {
  const state = getStoreState(store);
  const project = asObject(state.project || state.currentProject || state.workspace);
  const canvases = Array.isArray(state.canvases)
    ? state.canvases
    : Array.isArray(project.canvases)
      ? project.canvases
      : [];
  return trimString(
    spec.canvasId
      || payload.canvasId
      || node.canvasId
      || state.activeCanvasId
      || state.currentCanvasId
      || state.canvasId
      || project.activeCanvasId
      || project.currentCanvasId
      || project.canvasId
      || canvases[0]?.id
      || globalThis.window?.currentCanvasId
      || globalThis.window?.activeCanvasId
      || globalThis.currentCanvasId
      || globalThis.activeCanvasId
      || 'canvas_1'
  );
}

function resolveNow(options = {}) {
  return typeof options.now === 'function' ? options.now() : Date.now();
}

function resolveLocalRecoveryKind(spec = {}) {
  const taskSpec = asObject(spec);
  const text = normalizeLower(taskSpec.kind || taskSpec.taskKind || taskSpec.taskType || taskSpec.type);
  if (text.includes('image')) return 'image';
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  if (text.includes('text') || text.includes('chat')) return 'text';
  return 'provider_async';
}

function resolveLocalRecoveryProvider(spec = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  return trimString(taskSpec.provider || payload.provider);
}

function buildLocalRecoveryTaskCredentials(spec = {}, options = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const now = resolveNow(options);
  const kind = resolveLocalRecoveryKind(taskSpec);
  const provider = resolveLocalRecoveryProvider(taskSpec);
  const nodeId = trimString(taskSpec.targetNodeId || taskSpec.sourceNodeId || payload.nodeId || payload.targetNodeId);
  const runtimeTaskId = trimString(taskSpec.runtimeTaskId || payload.runtimeTaskId) || createAsyncRuntimeTaskId({
    kind,
    provider,
    nodeId,
    now,
  });
  const clientTaskId = trimString(taskSpec.clientTaskId || payload.clientTaskId) || `client:${runtimeTaskId}`;
  return { runtimeTaskId, clientTaskId, kind, provider, nodeId, now };
}

function buildSafeLocalRecoveryPayload(spec = {}, credentials = {}, options = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const nodeId = trimString(taskSpec.targetNodeId || credentials.nodeId || payload.nodeId || payload.targetNodeId);
  const store = resolveStore(options);
  const node = nodeId ? resolveNode(store, nodeId) || {} : {};
  const canvasId = resolveCanvasId(store, taskSpec, payload, node);
  return {
    provider: credentials.provider || trimString(payload.provider),
    model: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
    modelId: trimString(taskSpec.modelId || taskSpec.model || payload.modelId || payload.model),
    runtimeTaskId: credentials.runtimeTaskId,
    clientTaskId: credentials.clientTaskId,
    nodeId,
    canvasId,
    kind: credentials.kind,
    taskType: trimString(taskSpec.taskType || payload.taskType),
  };
}

function prepareTaskSpecWithLocalRecoveryCredentials(spec = {}, options = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const credentials = buildLocalRecoveryTaskCredentials(taskSpec, options);
  const nodeId = trimString(taskSpec.targetNodeId || credentials.nodeId || payload.nodeId || payload.targetNodeId);
  const store = resolveStore(options);
  const node = nodeId ? resolveNode(store, nodeId) || {} : {};
  const canvasId = resolveCanvasId(store, taskSpec, payload, node);
  return {
    ...taskSpec,
    canvasId,
    runtimeTaskId: credentials.runtimeTaskId,
    clientTaskId: credentials.clientTaskId,
    payload: {
      ...payload,
      runtimeTaskId: credentials.runtimeTaskId,
      clientTaskId: credentials.clientTaskId,
      nodeId,
      canvasId,
      provider: credentials.provider || payload.provider,
      kind: credentials.kind,
    },
  };
}

function precreateLocalAsyncTaskRecord(spec = {}, options = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const credentials = buildLocalRecoveryTaskCredentials(taskSpec, options);
  const targetNodeId = trimString(taskSpec.targetNodeId || payload.nodeId || credentials.nodeId);
  if (!targetNodeId || !credentials.runtimeTaskId) return null;
  const store = resolveStore(options);
  const node = resolveNode(store, targetNodeId) || {};
  const now = resolveNow(options);
  const createdAt = firstFiniteNumber(taskSpec.startedAt, taskSpec.createdAt, now) || now;
  const record = upsertAsyncTaskRecord({
    runtimeTaskId: credentials.runtimeTaskId,
    clientTaskId: credentials.clientTaskId,
    kind: credentials.kind,
    provider: credentials.provider,
    modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
    nodeId: targetNodeId,
    canvasId: resolveCanvasId(store, taskSpec, payload, node),
    sourceNodeId: trimString(taskSpec.sourceNodeId),
    status: 'running',
    canCancel: taskSpec.cancellable === true,
    canResume: taskSpec.resumable !== false,
    recoveryMode: trimString(taskSpec.recoveryMode || taskSpec.recoverySpec?.recoveryMode || payload.recoveryMode),
    recoveryCapability: taskSpec.recoveryCapability || taskSpec.recoverySpec?.recoveryCapability,
    pollingSpec: {
      kind: 'generation',
      taskType: trimString(taskSpec.taskType || credentials.kind),
      provider: credentials.provider,
      recoveryMode: trimString(taskSpec.recoveryMode || taskSpec.recoverySpec?.recoveryMode || payload.recoveryMode),
      recoveryCapability: taskSpec.recoveryCapability || taskSpec.recoverySpec?.recoveryCapability,
      adapterType: trimString(taskSpec.adapterType),
      modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
      executionId: trimString(taskSpec.executionId),
      sourceNodeId: trimString(taskSpec.sourceNodeId),
      targetNodeId,
      runtimeTaskId: credentials.runtimeTaskId,
      clientTaskId: credentials.clientTaskId,
      startedAt: createdAt,
      resumable: taskSpec.resumable !== false,
      cancellable: taskSpec.cancellable === true,
    },
    payload: buildSafeLocalRecoveryPayload(taskSpec, credentials, options),
    createdAt,
    updatedAt: now,
  }, {
    ...options,
    storage: options.asyncTaskStorage || options.storage,
    now,
  });
  if (record && typeof store?.updateNodeData === 'function') {
    store.updateNodeData(targetNodeId, {
      ...buildGenerationNodeStateProjection({
        phase: 'running',
        task: {
          ...record,
          status: 'running',
          recoveryMode: record.recoveryMode || 'local_proxy_poll',
          recoverySpec: record.pollingSpec,
        },
      }),
      clientTaskId: record.clientTaskId,
      taskProvider: record.provider,
      taskModelId: record.modelId,
      taskType: trimString(taskSpec.taskType || credentials.kind),
      taskAdapterType: trimString(taskSpec.adapterType) || 'modelApi',
      taskResumable: record.canResume,
    });
  }
  return record;
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
    node.pollingTaskId,
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
    node.pollingTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
    node.generationTaskId,
  ].map(trimString).filter(Boolean);
}

function shouldClearGenerationNodeForTask(node = {}, spec = {}, result = {}) {
  const pollingTaskId = resolvePollingTaskId(spec, result);
  const primaryTaskIds = collectPrimaryNodeRemoteTaskIds(node);
  if (pollingTaskId && primaryTaskIds.length > 0) return primaryTaskIds.includes(pollingTaskId);
  const nodeRemoteTaskIds = collectNodeRemoteTaskIds(node);
  if (pollingTaskId && nodeRemoteTaskIds.length > 0) return nodeRemoteTaskIds.includes(pollingTaskId);
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
    pollingTaskId: node.pollingTaskId,
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

function hasTerminalResultContent(result = {}) {
  const value = asObject(result);
  const nested = asObject(value.result);
  const candidates = [
    value.imageUrl,
    value.videoUrl,
    value.audioUrl,
    value.localPath,
    value.outputUrl,
    nested.imageUrl,
    nested.videoUrl,
    nested.audioUrl,
    nested.localPath,
    nested.outputUrl,
  ];
  return candidates.some((entry) => trimString(entry))
    || (Array.isArray(value.images) && value.images.length > 0)
    || (Array.isArray(nested.images) && nested.images.length > 0);
}

function isTerminalGenerationResult(result = {}) {
  const value = asObject(result);
  const nested = asObject(value.result);
  return GENERATION_TERMINAL_STATUSES.has(normalizeLower(value.status))
    || GENERATION_TERMINAL_STATUSES.has(normalizeLower(nested.status))
    || hasTerminalResultContent(value);
}

function resolveResultRemoteTaskId(result = {}) {
  const taskResult = asObject(result);
  const taskMeta = asObject(taskResult.taskMeta);
  const nestedResult = asObject(taskResult.result);
  return trimString(
    taskResult.remoteTaskId
      || taskResult.resultRemoteTaskId
      || taskMeta.remoteTaskId
      || nestedResult.remoteTaskId
      || nestedResult.resultRemoteTaskId
      || taskResult.id
      || nestedResult.id
  );
}

function resolveTerminalRemoteTaskId(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const nestedResult = asObject(taskResult.result);
  const explicitRemoteTaskId = resolveResultRemoteTaskId(taskResult);
  if (explicitRemoteTaskId) return explicitRemoteTaskId;
  if (!isTerminalGenerationResult(taskResult)) return '';
  const existingPollingTaskId = trimString(taskSpec.pollingTaskId || taskSpec.recoveryTaskId || taskSpec.taskId || taskSpec.asyncTaskId);
  const wrappedTaskId = trimString(taskResult.taskId || taskResult.task_id || nestedResult.taskId || nestedResult.task_id);
  return wrappedTaskId && wrappedTaskId !== existingPollingTaskId ? wrappedTaskId : '';
}

function resolvePollingTaskId(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const taskMeta = asObject(taskResult.taskMeta);
  const nestedResult = asObject(taskResult.result);
  const terminalResultId = isTerminalGenerationResult(taskResult) ? resolveTerminalRemoteTaskId(taskSpec, taskResult) : '';
  const candidate = trimString(
    taskResult.pollingTaskId
      || taskResult.recoveryTaskId
      || taskMeta.pollingTaskId
      || taskMeta.recoveryTaskId
      || taskSpec.pollingTaskId
      || taskSpec.recoveryTaskId
      || taskSpec.taskId
      || nestedResult.pollingTaskId
      || nestedResult.recoveryTaskId
      || taskResult.taskId
      || taskResult.task_id
      || taskResult.id
      || taskMeta.taskId
      || taskMeta.task_id
      || taskMeta.id
      || nestedResult.taskId
      || nestedResult.task_id
      || nestedResult.id
      || taskSpec.remoteTaskId
      || taskSpec.asyncTaskId
  );
  return candidate && candidate !== terminalResultId ? candidate : '';
}

function resolveRemoteTaskId(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  return trimString(resolveTerminalRemoteTaskId(taskSpec, result) || taskSpec.remoteTaskId);
}

function buildGenerationRecoverySpec({ spec = {}, result = {}, nodeId = '' } = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const pollingTaskId = resolvePollingTaskId(taskSpec, taskResult);
  const targetNodeId = trimString(nodeId || resolveTargetNodeId(taskSpec, taskResult));
  const payload = asObject(taskSpec.payload);
  const rawTaskMeta = asObject(taskResult.taskMeta || taskSpec.taskMeta);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...taskSpec,
    provider: taskSpec.provider || payload.provider || rawTaskMeta.provider,
    recoverySpec: taskSpec.recoverySpec,
    pollingSpec: taskSpec.recoverySpec || taskSpec.pollingSpec,
    payload,
    taskMeta: rawTaskMeta,
  });
  const recoveryMode = normalizeLower(taskSpec.recoveryMode || taskSpec.recoverySpec?.recoveryMode || rawTaskMeta.recoveryMode || capability.recoveryMode);
  const isLocalProxyRecovery = recoveryMode === 'local_proxy_poll' || capability.supportsLocalProxyRecovery;
  const taskMeta = isLocalProxyRecovery ? stripLocalProxyRemotePollingOptions(rawTaskMeta) : rawTaskMeta;
  const runtimeTaskId = trimString(taskSpec.runtimeTaskId || payload.runtimeTaskId || taskSpec.recoverySpec?.runtimeTaskId);
  const clientTaskId = trimString(taskSpec.clientTaskId || payload.clientTaskId || taskSpec.recoverySpec?.clientTaskId);
  if (recoveryMode === 'local_proxy_poll' || capability.supportsLocalProxyRecovery) {
    if (!targetNodeId || !(runtimeTaskId || clientTaskId)) return null;
    return {
      kind: 'generation',
      taskType: trimString(taskSpec.taskType || taskSpec.taskKind || taskSpec.kind),
      provider: trimString(taskSpec.provider || payload.provider || taskMeta.provider),
      recoveryMode: 'local_proxy_poll',
      recoveryCapability: capability,
      adapterType: trimString(taskSpec.adapterType),
      modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
      executionId: trimString(taskSpec.executionId),
      sourceNodeId: trimString(taskSpec.sourceNodeId),
      targetNodeId,
      taskId: '',
      pollingTaskId: '',
      queryableTaskId: '',
      runtimeTaskId,
      clientTaskId,
      remoteTaskId: resolveRemoteTaskId(taskSpec, taskResult),
      startedAt: firstFiniteNumber(taskSpec.startedAt, taskResult.startedAt) || 0,
      resumable: taskSpec.resumable !== false,
      cancellable: taskSpec.cancellable !== false,
      taskMeta,
      payload: { ...stripLocalProxyRemotePollingOptions(payload), runtimeTaskId, clientTaskId },
    };
  }
  if (!pollingTaskId || !targetNodeId) return null;
  return {
    kind: 'generation',
    taskType: trimString(taskSpec.taskType || taskSpec.taskKind || taskSpec.kind),
    provider: trimString(taskSpec.provider || payload.provider || taskMeta.provider),
    recoveryMode: 'remote_poll',
    recoveryCapability: capability,
    adapterType: trimString(taskSpec.adapterType),
    modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
    executionId: trimString(taskSpec.executionId),
    sourceNodeId: trimString(taskSpec.sourceNodeId),
    targetNodeId,
    taskId: pollingTaskId,
    pollingTaskId,
    remoteTaskId: resolveRemoteTaskId(taskSpec, taskResult),
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
  if (text.includes('text') || text.includes('chat') || text.includes('llm')) return 'text';
  if (text.includes('media')) return 'media';
  return 'provider_async';
}

function resolveExistingActiveAsyncTaskIdentity({ spec = {}, options = {}, recoverySpec = {}, kind = '' } = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const targetNodeId = trimString(recoverySpec.targetNodeId || taskSpec.targetNodeId || taskSpec.sourceNodeId || payload.nodeId || payload.targetNodeId);
  const provider = trimString(recoverySpec.provider || taskSpec.provider || payload.provider);
  const records = loadAsyncTaskRecords({ ...options, storage: options.asyncTaskStorage || options.storage });
  const matches = records.filter((record) => {
    if (!isAsyncTaskRecordActive(record)) return false;
    if (trimString(record.nodeId) !== targetNodeId) return false;
    if (trimString(record.provider) !== provider) return false;
    const recordKind = trimString(record.kind);
    return !kind || recordKind === kind || (recordKind === 'provider_async' && kind === 'image');
  });
  if (matches.length !== 1) return {};
  return {
    runtimeTaskId: trimString(matches[0].runtimeTaskId),
    clientTaskId: trimString(matches[0].clientTaskId),
  };
}

function persistAsyncTaskIdRecord({ spec = {}, options = {}, result = {}, status = 'polling' } = {}) {
  const taskSpec = asObject(spec);
  const taskResult = asObject(result);
  const recoverySpec = buildGenerationRecoverySpec({ spec: taskSpec, result: taskResult });
  const targetNodeId = recoverySpec?.targetNodeId || trimString(resolveTargetNodeId(taskSpec, taskResult));
  const nestedResultStatus = normalizeLower(asObject(taskResult.result).status);
  const providerTerminalStatus = GENERATION_TERMINAL_STATUSES.has(nestedResultStatus) ? nestedResultStatus : '';
  const inferredSuccessStatus = hasTerminalResultContent(taskResult) ? 'success' : '';
  const normalizedStatus = providerTerminalStatus || normalizeLower(status || taskResult.status || inferredSuccessStatus || 'polling') || 'polling';
  const terminalRemoteTaskId = GENERATION_TERMINAL_STATUSES.has(normalizedStatus) ? resolveTerminalRemoteTaskId(taskSpec, taskResult) : '';
  if (!recoverySpec && (!terminalRemoteTaskId || !targetNodeId)) return null;
  const now = resolveNow(options);
  const payload = asObject(taskSpec.payload);
  const fallbackRecordSpec = recoverySpec || {
    kind: 'generation',
    taskType: trimString(taskSpec.taskType || taskSpec.taskKind || taskSpec.kind),
    provider: trimString(taskSpec.provider || payload.provider || taskResult.taskMeta?.provider),
    adapterType: trimString(taskSpec.adapterType),
    modelId: trimString(taskSpec.modelId || taskSpec.model || payload.model || payload.modelId),
    sourceNodeId: trimString(taskSpec.sourceNodeId),
    targetNodeId,
    pollingTaskId: '',
    taskId: '',
    remoteTaskId: terminalRemoteTaskId,
    startedAt: firstFiniteNumber(taskSpec.startedAt, taskResult.startedAt) || 0,
    resumable: taskSpec.resumable !== false,
    cancellable: taskSpec.cancellable !== false,
    taskMeta: asObject(taskResult.taskMeta || taskSpec.taskMeta),
    payload,
  };
  const kind = resolveAsyncTaskRecordKind(fallbackRecordSpec);
  const existingActiveIdentity = resolveExistingActiveAsyncTaskIdentity({
    spec: taskSpec,
    options,
    recoverySpec: fallbackRecordSpec,
    kind,
  });
  const store = resolveStore(options);
  const node = resolveNode(store, fallbackRecordSpec.targetNodeId) || {};
  const recordPollingTaskId = recoverySpec && (!terminalRemoteTaskId || terminalRemoteTaskId !== (fallbackRecordSpec.pollingTaskId || fallbackRecordSpec.taskId))
    ? (fallbackRecordSpec.pollingTaskId || fallbackRecordSpec.taskId)
    : '';
  const record = upsertAsyncTaskRecord({
    runtimeTaskId: trimString(fallbackRecordSpec.runtimeTaskId || taskSpec.runtimeTaskId || payload.runtimeTaskId || existingActiveIdentity.runtimeTaskId),
    clientTaskId: trimString(fallbackRecordSpec.clientTaskId || taskSpec.clientTaskId || payload.clientTaskId || existingActiveIdentity.clientTaskId),
    pollingTaskId: recordPollingTaskId,
    queryableTaskId: recordPollingTaskId,
    remoteTaskId: terminalRemoteTaskId || fallbackRecordSpec.remoteTaskId,
    recoveryMode: trimString(fallbackRecordSpec.recoveryMode || taskSpec.recoveryMode),
    recoveryCapability: fallbackRecordSpec.recoveryCapability,
    kind,
    provider: fallbackRecordSpec.provider || fallbackRecordSpec.payload?.provider,
    modelId: fallbackRecordSpec.modelId,
    nodeId: fallbackRecordSpec.targetNodeId,
    canvasId: trimString(taskSpec.canvasId || taskResult.canvasId || node.canvasId),
    sourceNodeId: fallbackRecordSpec.sourceNodeId,
    status: normalizedStatus,
    error: taskResult.error || asObject(taskResult.result).error || taskResult.message || asObject(taskResult.result).message || '',
    resultSpec: taskResult.result || taskResult,
    canCancel: GENERATION_TERMINAL_STATUSES.has(normalizedStatus) ? false : fallbackRecordSpec.cancellable !== false,
    canResume: GENERATION_TERMINAL_STATUSES.has(normalizedStatus) ? false : (recoverySpec ? fallbackRecordSpec.resumable !== false : false),
    ...(normalizedStatus === 'cancelled' ? { cancelReason: 'user', userCancelled: true } : {}),
    pollingSpec: recoverySpec || null,
    payload: fallbackRecordSpec.payload,
    createdAt: firstFiniteNumber(fallbackRecordSpec.startedAt, taskSpec.createdAt, taskResult.createdAt) || now,
    updatedAt: firstFiniteNumber(taskResult.updatedAt, taskSpec.updatedAt) || now,
    finishedAt: GENERATION_TERMINAL_STATUSES.has(normalizedStatus)
      ? firstFiniteNumber(taskResult.finishedAt, taskResult.updatedAt, now) || now
      : 0,
  }, {
    ...options,
    storage: options.asyncTaskStorage || options.storage,
    now,
  });
  if (record && recoverySpec && typeof store?.updateNodeData === 'function') {
    store.updateNodeData(fallbackRecordSpec.targetNodeId, {
      asyncRuntimeTaskId: record.runtimeTaskId,
      remoteTaskId: record.remoteTaskId,
      pollingTaskId: record.pollingTaskId,
      asyncTaskId: record.pollingTaskId,
      taskProvider: record.provider,
      taskModelId: record.modelId,
      taskType: trimString(fallbackRecordSpec.taskType),
      taskAdapterType: trimString(fallbackRecordSpec.adapterType) || 'modelApi',
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
  const terminalStatuses = ['success', 'complete', 'completed', 'done', 'failed', 'cancelled', 'canceled', 'interrupted'];
  if (terminalStatuses.includes(taskStatus)) return;
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
    pollingTaskId: trimString(recoverySpec.pollingTaskId || recoverySpec.taskId),
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

function syncGenerationTaskTerminalState({ spec = {}, options = {}, result = {}, status = '' } = {}) {
  const normalizedStatus = normalizeLower(status || result.status);
  if (!['success', 'complete', 'completed', 'done', 'failed', 'cancelled', 'canceled', 'interrupted'].includes(normalizedStatus)) return null;
  return persistAsyncTaskIdRecord({ spec, options, result, status: normalizedStatus });
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
  const preparedSpec = prepareTaskSpecWithLocalRecoveryCredentials(spec, options);
  precreateLocalAsyncTaskRecord(preparedSpec, options);
  const taskSpec = wrapSpecForTaskCenterRecovery(preparedSpec, options);
  syncGenerationTaskToTaskCenter({ spec: taskSpec, options, status: 'running' });
  const result = await submitGenerationTask(taskSpec, options);
  const finalResult = isLocalProxyFrontendTransportInterruption(taskSpec, result)
    ? buildLocalProxyPausedResult(taskSpec, result)
    : result;
  persistAsyncTaskIdRecord({
    spec: taskSpec,
    options,
    result: finalResult,
    status: finalResult?.status === 'paused' ? 'polling' : (finalResult?.status || 'polling'),
  });
  syncGenerationTaskToTaskCenter({
    spec: taskSpec,
    options,
    result: finalResult,
    status: finalResult?.status === 'paused' ? 'polling' : finalResult?.status,
    error: finalResult?.error,
  });
  return finalResult;
}

function isLocalProxyInterruptedRecovery(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  if (normalizeLower(taskSpec.recoveryMode || taskSpec.recoverySpec?.recoveryMode) !== 'local_proxy_poll') return false;
  const status = normalizeLower(result?.error?.localProxyStatus);
  const reason = normalizeLower(result?.error?.localProxyReason || result?.error?.message || result?.error || result?.message);
  if (status && status !== 'missing') return false;
  return reason.includes('request_lost')
    || reason.includes('missing')
    || reason.includes('not_found')
    || reason.includes('expired')
    || reason.includes('不可恢复');
}

function isLocalProxyFrontendTransportInterruption(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...taskSpec,
    payload,
    pollingSpec: taskSpec.recoverySpec || taskSpec.pollingSpec,
  });
  if (normalizeLower(taskSpec.recoveryMode || taskSpec.recoverySpec?.recoveryMode || capability.recoveryMode) !== 'local_proxy_poll') return false;
  if (!capability.supportsLocalProxyRecovery) return false;
  const status = normalizeLower(result?.status);
  if (status !== 'failed') return false;
  const message = normalizeLower(result?.error?.message || result?.error || result?.message);
  return message.includes('网络连接失败')
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('load failed')
    || message.includes('aborted');
}

function buildLocalProxyPausedResult(spec = {}, result = {}) {
  const taskSpec = asObject(spec);
  const payload = asObject(taskSpec.payload);
  return {
    ...asObject(result),
    status: 'paused',
    pending: true,
    targetNodeId: trimString(result?.targetNodeId || taskSpec.targetNodeId || payload.nodeId),
    taskId: trimString(result?.taskId || taskSpec.runtimeTaskId || payload.runtimeTaskId || taskSpec.clientTaskId || payload.clientTaskId),
    error: null,
  };
}

function markLocalProxyInterruptedNode(spec = {}, options = {}) {
  const store = resolveStore(options);
  const nodeId = trimString(spec.targetNodeId || spec.recoverySpec?.targetNodeId);
  if (!nodeId || typeof store?.updateNodeData !== 'function') return;
  store.updateNodeData(nodeId, {
    isGenerating: false,
    jobStatus: 'idle',
    jobError: null,
    asyncTaskStatus: 'interrupted',
    asyncTaskRecovering: false,
  });
}

export async function resumeTask(spec, options = {}) {
  const taskSpec = attachRestoredCancelSpec(spec, options);
  syncGenerationTaskToTaskCenter({ spec: taskSpec, options, status: 'polling' });
  const result = await resumeGenerationTask(taskSpec, options);
  const finalResult = isLocalProxyInterruptedRecovery(taskSpec, result)
    ? { ...result, status: 'interrupted' }
    : result;
  if (finalResult !== result) markLocalProxyInterruptedNode(taskSpec, options);
  syncGenerationTaskTerminalState({ spec: taskSpec, options, result: finalResult, status: finalResult?.status });
  syncGenerationTaskToTaskCenter({
    spec: taskSpec,
    options,
    result: finalResult,
    status: finalResult?.status,
    error: finalResult?.error,
  });
  return finalResult;
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
  const hasRecoveryCancelSpec = Boolean(
    recoverySpec.taskId
      || recoverySpec.runtimeTaskId
      || recoverySpec.clientTaskId
      || recoverySpec.recoveryMode
  );
  const recoveryCancelSpec = hasRecoveryCancelSpec ? attachRestoredCancelSpec({
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
  syncGenerationTaskTerminalState({
    spec: { ...effectiveCancelSpec, targetNodeId: nodeId || targetNodeId },
    options,
    result: { ...result, targetNodeId: nodeId || targetNodeId },
    status: 'cancelled',
  });
  syncGenerationTaskToTaskCenter({
    spec: { ...effectiveCancelSpec, targetNodeId: nodeId || targetNodeId },
    options,
    result: { ...result, targetNodeId: nodeId || targetNodeId },
    status: 'cancelled',
    error: null,
  });
  return result;
}
