import appStore from './stores/appStore.js';
import { installAsyncTaskLoadingRecovery } from './asyncTaskRuntime.js';
import {
  isAsyncTaskRecordActive,
  loadAsyncTaskRecords,
  upsertAsyncTaskRecord,
} from './asyncTaskStore.js';
import {
  hasAsyncTaskLocalRecoveryCredential,
  resolveAsyncTaskLocalRecoveryTaskId,
  resolveAsyncTaskRecoveryCapability,
} from './asyncTaskRecoveryCapabilities.js';
import { coordinateRestoredGenerationRecovery } from './unifiedTaskCenterGenerationRecoveryCoordinator.js';
import {
  buildGenerationRecoveryV2Tickets,
  startGenerationRecoveryV2,
} from './generationRecoveryV2.js';

const DEFAULT_STORAGE_KEY = 'ai-canvas:unified-task-center:snapshot:v1';
const DEFAULT_MAX_TASKS = 120;
const DEFAULT_DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending', 'polling', 'loading', 'generating', 'submitted', 'in_progress', 'in-progress', 'active']);
const TERMINAL_STATUSES = new Set(['success', 'succeeded', 'complete', 'completed', 'done', 'finished', 'failed', 'fail', 'failure', 'errored', 'error', 'cancelled', 'canceled', 'interrupted']);
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|credential|cookie|headers?|body|request)/i;
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
const TASK_CENTER_STORAGE_PATCH_MARKER_KEY = '__unifiedTaskCenterSnapshotStoragePatched';
const taskCenterSnapshotStoragePatchRegistrations = [];
const patchedPlainStorages = new WeakSet();
let storagePrototypePatched = false;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTaskCenterStatus(status) {
  const value = trimString(status).toLowerCase();
  if (['success', 'succeeded', 'completed', 'done', 'finished'].includes(value)) return 'complete';
  if (['fail', 'failure', 'errored', 'error'].includes(value)) return 'failed';
  if (value === 'canceled') return 'cancelled';
  if (value === 'interrupted' || value === 'interrupt') return 'interrupted';
  return value || 'waiting';
}

function getStorage(options = {}) {
  return options.storage || globalThis.localStorage || null;
}

function getStorageKey(options = {}) {
  return trimString(options.storageKey) || DEFAULT_STORAGE_KEY;
}

function sanitizeError(error) {
  if (!error) return '';
  if (typeof error === 'string') return error.slice(0, 2000);
  const object = asObject(error);
  return trimString(object.message || object.error || object.userMessage).slice(0, 2000);
}

function sanitizeRefs(refs) {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => {
      const item = asObject(ref);
      const kind = trimString(item.kind);
      const value = trimString(item.value);
      if (!kind || !value) return null;
      return {
        kind,
        value,
        ...(Number.isFinite(Number(item.index)) ? { index: Number(item.index) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 40);
}

function sanitizeResult(result) {
  const source = asObject(result);
  const output = {};
  for (const key of ['localPath', 'imageUrl', 'videoUrl', 'audioUrl', 'thumbUrl']) {
    const value = trimString(source[key]);
    if (value) output[key] = value;
  }
  return Object.keys(output).length ? output : null;
}

function sanitizePlainValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null) return value;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePlainValue(item, depth + 1))
      .filter((item) => item !== undefined)
      .slice(0, 60);
  }
  if (typeof value !== 'object') return undefined;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizePlainValue(entry, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function sanitizePayload(payload) {
  const source = asObject(payload);
  const output = {};
  const allowedKeys = [
    'provider', 'model', 'modelId', 'prompt', 'negativePrompt', 'aspectRatio', 'ratio', 'resolution',
    'size', 'imageSize', 'width', 'height', 'duration', 'durationSec', 'batchSize', 'cameraAngle',
    'mode', 'style', 'quality', 'taskKind', 'taskType', 'adapterType', 'executionId', 'modelVersion',
    'useOpenapiQuery', 'rhInstanceType', 'audioWorkflowKey', 'audioWorkflowLabel', 'sourceNodeId',
    'targetNodeId', 'nodeId', 'installId', 'responseMapping', 'taskPolling', 'runtimeTaskId',
    'clientTaskId', 'recoveryMode', 'queryableTaskId', 'pollingTaskId',
  ];
  for (const key of allowedKeys) {
    if (!(key in source)) continue;
    const sanitized = sanitizePlainValue(source[key]);
    if (sanitized !== undefined && sanitized !== '') output[key] = sanitized;
  }
  return output;
}

function resolveSnapshotQueryableTaskId(source = {}) {
  return trimString(source.queryableTaskId
    || source.pollingTaskId
    || source.recoveryTaskId
    || source.asyncTaskId
    || source.providerTaskId
    || source.pollTaskId
    || source.taskId);
}

function sanitizeRecoverySpec(spec) {
  const source = asObject(spec);
  const payload = asObject(source.payload);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...source,
    recoverySpec: source,
    payload,
    pollingSpec: source,
  });
  const targetNodeId = trimString(source.targetNodeId || source.nodeId);
  if (!targetNodeId) return null;
  const queryableTaskId = capability.supportsRemotePoll ? resolveSnapshotQueryableTaskId(source) : '';
  const localRecoveryTaskId = resolveAsyncTaskLocalRecoveryTaskId({ ...source, recoverySpec: source, pollingSpec: source, payload });
  const runtimeTaskId = trimString(source.runtimeTaskId || payload.runtimeTaskId || localRecoveryTaskId);
  const clientTaskId = trimString(source.clientTaskId || payload.clientTaskId);
  const taskId = capability.supportsRemotePoll ? queryableTaskId : trimString(localRecoveryTaskId || runtimeTaskId || clientTaskId);
  const normalizedTaskMeta = capability.supportsLocalProxyRecovery
    ? stripLocalProxyRemotePollingOptions(source.taskMeta)
    : asObject(source.taskMeta);
  const normalizedPayload = capability.supportsLocalProxyRecovery
    ? stripLocalProxyRemotePollingOptions(payload)
    : payload;
  if (!taskId) return null;
  if (capability.supportsRemotePoll && !queryableTaskId) return null;
  if (capability.supportsLocalProxyRecovery && !hasAsyncTaskLocalRecoveryCredential({ ...source, recoverySpec: source, pollingSpec: source, payload, runtimeTaskId, clientTaskId })) return null;
  if (!capability.supportsRemotePoll && !capability.supportsLocalProxyRecovery) return null;
  return {
    version: 1,
    kind: trimString(source.kind) || 'generation',
    taskType: trimString(source.taskType || source.type),
    provider: trimString(source.provider),
    recoveryMode: capability.recoveryMode,
    recoveryCapability: capability,
    adapterType: trimString(source.adapterType),
    modelId: trimString(source.modelId || source.model),
    executionId: trimString(source.executionId),
    sourceNodeId: trimString(source.sourceNodeId),
    targetNodeId,
    taskId,
    queryableTaskId,
    pollingTaskId: queryableTaskId,
    runtimeTaskId,
    clientTaskId,
    remoteTaskId: trimString(source.remoteTaskId || source.resultRemoteTaskId),
    remoteResultId: trimString(source.remoteResultId || source.resultId),
    startedAt: finiteNumber(source.startedAt, 0),
    resumable: source.resumable !== false,
    cancellable: source.cancellable !== false,
    taskMeta: sanitizePayload(normalizedTaskMeta),
    payload: sanitizePayload({ ...normalizedPayload, runtimeTaskId, clientTaskId }),
  };
}

function sanitizeUnifiedTask(task) {
  const source = asObject(task);
  if (!source.id) return null;
  return {
    id: trimString(source.id),
    kind: trimString(source.kind),
    status: trimString(source.status),
    nodeId: trimString(source.nodeId),
    canvasId: trimString(source.canvasId),
    provider: trimString(source.provider),
    model: trimString(source.model),
    title: trimString(source.title),
    promptSummary: trimString(source.promptSummary).slice(0, 500),
    progress: source.progress == null ? null : (Number.isFinite(Number(source.progress)) ? Number(source.progress) : null),
    canCancel: source.canCancel === true,
    canRetry: source.canRetry === true,
    canResume: source.canResume === true,
    inputRefs: sanitizeRefs(source.inputRefs),
    outputRefs: sanitizeRefs(source.outputRefs),
    error: source.error ? { message: sanitizeError(source.error) } : null,
    createdAt: finiteNumber(source.createdAt, 0),
    updatedAt: finiteNumber(source.updatedAt, 0),
  };
}

export function sanitizeTaskCenterTask(task = {}) {
  const source = asObject(task);
  const taskId = trimString(source.taskId);
  if (!taskId) return null;
  const status = normalizeTaskCenterStatus(source.status);
  return {
    taskId,
    nodeId: trimString(source.nodeId),
    assetId: trimString(source.assetId),
    kind: trimString(source.kind),
    status,
    provider: trimString(source.provider),
    model: trimString(source.model || source.modelId),
    modelId: trimString(source.modelId || source.model),
    progress: Math.max(0, Math.min(1, finiteNumber(source.progress, 0))),
    message: trimString(source.message).slice(0, 500),
    error: sanitizeError(source.error),
    result: sanitizeResult(source.result),
    createdAt: finiteNumber(source.createdAt, Date.now()),
    startedAt: finiteNumber(source.startedAt, 0),
    finishedAt: finiteNumber(source.finishedAt, 0),
    updatedAt: finiteNumber(source.updatedAt, Date.now()),
    unifiedTask: sanitizeUnifiedTask(source.unifiedTask),
    recoverySpec: sanitizeRecoverySpec(source.recoverySpec || source.unifiedTask?.recoverySpec),
  };
}

function canResumeTask(task) {
  return Boolean(task?.recoverySpec?.taskId && task?.recoverySpec?.targetNodeId);
}

function isGenerationTask(task) {
  const kind = trimString(task?.kind);
  const unifiedKind = trimString(task?.unifiedTask?.kind);
  const taskId = trimString(task?.taskId);
  return kind === 'videoGeneration'
    || kind === 'imageGeneration'
    || kind === 'audioGeneration'
    || kind === 'providerAsyncGeneration'
    || unifiedKind === 'video'
    || unifiedKind === 'image'
    || unifiedKind === 'audio'
    || unifiedKind === 'provider_async'
    || taskId.startsWith('generation:');
}

function isMediaTask(task) {
  const kind = trimString(task?.kind);
  const taskId = trimString(task?.taskId);
  return kind === 'mediaTask'
    || LOCAL_MEDIA_TASK_KINDS.has(kind)
    || task?.unifiedTask?.kind === 'media'
    || taskId.startsWith('media:');
}

function isObsoleteMediaInterruptionTask(task) {
  if (task?.status !== 'failed' || isGenerationTask(task)) return false;
  const message = trimString(task.error || task.unifiedTask?.error?.message || task.message);
  return /刷新|重启|中断/.test(message);
}

function isObsoleteGenerationInterruptionTask(task) {
  if (task?.status !== 'failed' || !isGenerationTask(task)) return false;
  const message = trimString(task.error || task.unifiedTask?.error?.message || task.message);
  return /刷新|重启|中断/.test(message);
}

function resolveTaskRecoveryId(task = {}) {
  const recoverySpec = asObject(task.recoverySpec || task.unifiedTask?.recoverySpec);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...task,
    ...recoverySpec,
    recoverySpec,
    payload: recoverySpec.payload,
    pollingSpec: recoverySpec,
  });
  if (capability.supportsRemotePoll) {
    return trimString(
      task.queryableTaskId
        || task.pollingTaskId
        || task.recoveryTaskId
        || task.asyncTaskId
        || task.providerTaskId
        || recoverySpec.queryableTaskId
        || recoverySpec.pollingTaskId
        || recoverySpec.recoveryTaskId
        || recoverySpec.asyncTaskId
        || recoverySpec.providerTaskId
        || recoverySpec.taskId
    );
  }
  if (capability.supportsLocalProxyRecovery) {
    return trimString(task.runtimeTaskId || task.clientTaskId || recoverySpec.runtimeTaskId || recoverySpec.clientTaskId || recoverySpec.taskId);
  }
  return '';
}

function isSameGenerationAttempt(previous = {}, incoming = {}) {
  const previousRecoveryId = resolveTaskRecoveryId(previous);
  const incomingRecoveryId = resolveTaskRecoveryId(incoming);
  if (previousRecoveryId && incomingRecoveryId) return previousRecoveryId === incomingRecoveryId;
  const previousFinishedAt = finiteNumber(previous.finishedAt || previous.updatedAt, 0);
  const incomingStartedAt = finiteNumber(incoming.startedAt || incoming.createdAt, 0);
  return !incomingStartedAt || !previousFinishedAt || incomingStartedAt <= previousFinishedAt;
}

function shouldKeepCancelledTerminalTask(previous = {}, incoming = {}) {
  if (previous.status !== 'cancelled' || !ACTIVE_STATUSES.has(incoming.status)) return false;
  if (isMediaTask(previous) && isMediaTask(incoming)) return true;
  if (isGenerationTask(previous) && isGenerationTask(incoming)) return isSameGenerationAttempt(previous, incoming);
  return false;
}

function shouldKeepActiveGenerationTask(previous = {}, incoming = {}) {
  if (!ACTIVE_STATUSES.has(previous.status) || !TERMINAL_STATUSES.has(incoming.status)) return false;
  if (!isGenerationTask(previous) || !isGenerationTask(incoming)) return false;
  const previousRecoveryId = resolveTaskRecoveryId(previous);
  const incomingRecoveryId = resolveTaskRecoveryId(incoming);
  if (previousRecoveryId && incomingRecoveryId) return previousRecoveryId !== incomingRecoveryId;
  const previousStartedAt = finiteNumber(previous.startedAt || previous.createdAt, 0);
  const incomingStartedAt = finiteNumber(incoming.startedAt || incoming.createdAt, 0);
  if (previousStartedAt && incomingStartedAt) return incomingStartedAt < previousStartedAt;
  const previousUpdatedAt = finiteNumber(previous.updatedAt, 0);
  const incomingFinishedAt = finiteNumber(incoming.finishedAt || incoming.updatedAt, 0);
  return Boolean(previousUpdatedAt && incomingFinishedAt && incomingFinishedAt < previousUpdatedAt);
}

function normalizeCancelledTerminalTask(task = {}, now) {
  return {
    ...task,
    status: 'cancelled',
    message: task.message || '已取消',
    error: '',
    finishedAt: finiteNumber(task.finishedAt, now),
    updatedAt: now,
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      status: 'cancelled',
      canCancel: false,
      canRetry: false,
      canResume: false,
      error: null,
      updatedAt: now,
    } : null,
  };
}

function normalizeRestoredMediaTask(task, now) {
  const message = task.message || '后台媒体任务状态待同步';
  return {
    ...task,
    kind: task.kind || 'mediaTask',
    status: 'processing',
    message,
    error: '',
    finishedAt: 0,
    updatedAt: now,
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      status: 'running',
      canCancel: true,
      canRetry: false,
      canResume: false,
      error: null,
      updatedAt: now,
    } : null,
  };
}

function normalizeRestoredGenerationPendingTask(task, now) {
  const message = task.message || '生成状态恢复中';
  return {
    ...task,
    status: 'processing',
    message,
    error: '',
    finishedAt: 0,
    updatedAt: now,
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      status: 'running',
      canCancel: false,
      canRetry: false,
      canResume: Boolean(task.recoverySpec),
      error: null,
      updatedAt: now,
    } : null,
  };
}

function normalizeRestoredGenerationInterruptedTask(task, now) {
  const message = task.message || '生成请求已中断，需要重新发起';
  return {
    ...task,
    status: 'interrupted',
    message,
    error: task.error || message,
    finishedAt: finiteNumber(task.finishedAt, now),
    updatedAt: now,
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      status: 'interrupted',
      canCancel: false,
      canRetry: false,
      canResume: false,
      error: { message },
      updatedAt: now,
    } : null,
  };
}

function normalizeRestoredActiveTask(task, now) {
  if (isObsoleteGenerationInterruptionTask(task)) return normalizeRestoredGenerationPendingTask(task, now);
  if (isObsoleteMediaInterruptionTask(task)) return normalizeRestoredMediaTask(task, now);
  if (!ACTIVE_STATUSES.has(task.status)) return task;
  if (isMediaTask(task)) return normalizeRestoredMediaTask(task, now);
  if (canResumeTask(task)) {
    return {
      ...task,
      status: 'processing',
      message: task.message || '恢复中',
      error: '',
      updatedAt: now,
      unifiedTask: task.unifiedTask ? {
        ...task.unifiedTask,
        status: 'polling',
        canCancel: false,
        canRetry: false,
        canResume: true,
        error: null,
        updatedAt: now,
      } : null,
    };
  }
  return normalizeRestoredGenerationInterruptedTask(task, now);
}

function shouldKeepTask(task, now, retentionMs) {
  if (!TERMINAL_STATUSES.has(task.status)) return true;
  const timestamp = finiteNumber(task.finishedAt || task.updatedAt || task.createdAt, 0);
  return !timestamp || now - timestamp <= retentionMs;
}

function resolveAsyncTaskKindFromTaskCenterTask(task = {}) {
  const source = asObject(task);
  const recoverySpec = asObject(source.recoverySpec || source.unifiedTask?.recoverySpec);
  const text = trimString(recoverySpec.taskType || recoverySpec.kind || source.taskType || source.taskKind || source.unifiedTask?.kind || source.kind).toLowerCase();
  if (text.includes('image')) return 'image';
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  if (text.includes('media')) return 'media';
  if (text.includes('text') || text.includes('chat') || text.includes('llm')) return 'text';
  return 'provider_async';
}

function resolveNodeSnapshotForTask(task = {}, options = {}) {
  const nodeId = trimString(
    task.recoverySpec?.targetNodeId
      || task.recoverySpec?.nodeId
      || task.targetNodeId
      || task.nodeId
      || task.unifiedTask?.nodeId
  );
  if (!nodeId) return {};
  const store = options.store || appStore;
  const state = typeof store?.getStateRaw === 'function'
    ? store.getStateRaw()
    : (typeof store?.getState === 'function' ? store.getState() : store?.state);
  return asObject(asObject(state).nodes?.[nodeId]);
}

function resolveTaskCenterTaskAsyncFields(task = {}, options = {}) {
  const source = asObject(task);
  const nodeSnapshot = resolveNodeSnapshotForTask(source, options);
  const recoverySpec = asObject(source.recoverySpec || source.unifiedTask?.recoverySpec);
  const payload = asObject(source.payload || recoverySpec.payload || source.unifiedTask?.payload);
  const taskMeta = asObject(source.taskMeta || recoverySpec.taskMeta || source.unifiedTask?.taskMeta);
  const result = asObject(source.result);
  const provider = trimString(recoverySpec.provider || payload.provider || source.provider || source.unifiedTask?.provider || nodeSnapshot.asyncTaskProvider || nodeSnapshot.taskProvider || nodeSnapshot.provider);
  const capabilitySource = {
    ...source,
    provider,
    recoveryMode: recoverySpec.recoveryMode || source.recoveryMode,
    recoveryCapability: recoverySpec.recoveryCapability || source.recoveryCapability,
    recoverySpec,
    pollingSpec: recoverySpec,
    payload,
    taskMeta,
  };
  const capability = resolveAsyncTaskRecoveryCapability(capabilitySource);
  const queryableTaskId = capability.supportsRemotePoll ? trimString(
    source.queryableTaskId
      || source.pollingTaskId
      || source.recoveryTaskId
      || source.asyncTaskId
      || source.providerTaskId
      || source.providerTaskID
      || source.jobId
      || source.job_id
      || taskMeta.queryableTaskId
      || taskMeta.pollingTaskId
      || taskMeta.recoveryTaskId
      || taskMeta.taskId
      || taskMeta.asyncTaskId
      || taskMeta.providerTaskId
      || taskMeta.jobId
      || taskMeta.job_id
      || recoverySpec.queryableTaskId
      || recoverySpec.pollingTaskId
      || recoverySpec.recoveryTaskId
      || recoverySpec.asyncTaskId
      || recoverySpec.providerTaskId
      || recoverySpec.jobId
      || recoverySpec.job_id
      || recoverySpec.taskId
      || nodeSnapshot.asyncTaskId
      || nodeSnapshot.pollingTaskId
      || nodeSnapshot.rhTaskId
      || nodeSnapshot.dreaminaSubmitId
      || nodeSnapshot.providerTaskId
      || nodeSnapshot.jobId
      || nodeSnapshot.taskId
      || nodeSnapshot.generationTaskId
  ) : '';
  const runtimeTaskId = trimString(source.runtimeTaskId || recoverySpec.runtimeTaskId || payload.runtimeTaskId || nodeSnapshot.asyncRuntimeTaskId || nodeSnapshot.runtimeTaskId);
  const clientTaskId = trimString(source.clientTaskId || recoverySpec.clientTaskId || payload.clientTaskId || nodeSnapshot.clientTaskId);
  if (capability.supportsRemotePoll && !queryableTaskId) return null;
  if (capability.supportsLocalProxyRecovery && !hasAsyncTaskLocalRecoveryCredential({ ...capabilitySource, runtimeTaskId, clientTaskId })) return null;
  if (!capability.supportsRemotePoll && !capability.supportsLocalProxyRecovery) return null;
  const taskId = capability.supportsRemotePoll ? queryableTaskId : trimString(runtimeTaskId || clientTaskId);
  if (!taskId || taskId.startsWith('generation:') || taskId.startsWith('media:')) return null;
  const nodeId = trimString(
    recoverySpec.targetNodeId
      || recoverySpec.nodeId
      || source.targetNodeId
      || source.nodeId
      || source.unifiedTask?.nodeId
      || payload.targetNodeId
      || payload.nodeId
      || nodeSnapshot.id
  );
  if (!nodeId) return null;
  return {
    pollingTaskId: queryableTaskId,
    queryableTaskId,
    runtimeTaskId,
    clientTaskId,
    recoveryMode: capability.recoveryMode,
    recoveryCapability: capability,
    remoteTaskId: trimString(source.remoteTaskId || result.remoteTaskId || taskMeta.remoteTaskId || recoverySpec.remoteTaskId),
    remoteResultId: trimString(source.remoteResultId || source.resultId || result.remoteResultId || result.resultId || result.id || taskMeta.remoteResultId || recoverySpec.remoteResultId),
    nodeId,
    recoverySpec,
    payload,
    provider,
    modelId: trimString(recoverySpec.modelId || recoverySpec.model || payload.model || payload.modelId || source.modelId || source.model || source.unifiedTask?.model || nodeSnapshot.taskModelId || nodeSnapshot.modelId || nodeSnapshot.model),
    sourceNodeId: trimString(recoverySpec.sourceNodeId || source.sourceNodeId || payload.sourceNodeId),
  };
}

function mirrorTaskCenterTaskToAsyncTaskStore(task = {}, options = {}, nowValue = null) {
  const status = normalizeTaskCenterStatus(task.status);
  if (!ACTIVE_STATUSES.has(status) && !TERMINAL_STATUSES.has(status)) return null;
  const fields = resolveTaskCenterTaskAsyncFields(task, options);
  if (!fields) return null;
  const now = finiteNumber(nowValue ?? options.now, Date.now());
  const isTerminal = TERMINAL_STATUSES.has(status);
  const record = upsertAsyncTaskRecord({
    runtimeTaskId: fields.runtimeTaskId,
    clientTaskId: fields.clientTaskId,
    pollingTaskId: fields.pollingTaskId,
    queryableTaskId: fields.queryableTaskId,
    remoteTaskId: fields.remoteTaskId,
    remoteResultId: fields.remoteResultId,
    recoveryMode: fields.recoveryMode,
    recoveryCapability: fields.recoveryCapability,
    kind: resolveAsyncTaskKindFromTaskCenterTask(task),
    provider: fields.provider,
    modelId: fields.modelId,
    nodeId: fields.nodeId,
    canvasId: trimString(task.canvasId || task.unifiedTask?.canvasId),
    sourceNodeId: fields.sourceNodeId,
    status: isTerminal ? status : 'polling',
    error: sanitizeError(task.error || task.unifiedTask?.error),
    resultSpec: isTerminal ? task.result : null,
    canCancel: !isTerminal && fields.recoverySpec.cancellable === true,
    canResume: !isTerminal && fields.recoverySpec.resumable !== false,
    pollingSpec: fields.recoverySpec,
    payload: fields.payload,
    createdAt: finiteNumber(fields.recoverySpec.startedAt || task.startedAt || task.createdAt, now),
    updatedAt: finiteNumber(task.updatedAt || now, now),
    finishedAt: isTerminal ? finiteNumber(task.finishedAt || task.updatedAt || now, now) : 0,
  }, {
    storage: options.asyncTaskStorage || options.storage,
    storageKey: options.asyncTaskStorageKey,
    now,
  });
  return record;
}

function mirrorTaskCenterTasksToAsyncTaskStore(tasks = [], options = {}, nowValue = null) {
  const items = Array.isArray(tasks) ? tasks : Array.from(tasks || []);
  for (const entry of items) {
    mirrorTaskCenterTaskToAsyncTaskStore(Array.isArray(entry) ? entry[1] : entry, options, nowValue);
  }
}

function mirrorTaskCenterSnapshotToAsyncTaskStore(snapshot = {}, options = {}) {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (items.length === 0) return;
  mirrorTaskCenterTasksToAsyncTaskStore(items, options, finiteNumber(snapshot.savedAt || options.now, Date.now()));
}

export function serializeTaskCenterSnapshot(tasks = [], options = {}) {
  const now = finiteNumber(options.now, Date.now());
  const maxTasks = Math.max(1, finiteNumber(options.maxTasks, DEFAULT_MAX_TASKS));
  const retentionMs = Math.max(0, finiteNumber(options.doneRetentionMs, DEFAULT_DONE_RETENTION_MS));
  const items = (Array.isArray(tasks) ? tasks : Array.from(tasks || []))
    .map((entry) => Array.isArray(entry) ? entry[1] : entry)
    .map(sanitizeTaskCenterTask)
    .filter(Boolean)
    .filter((task) => shouldKeepTask(task, now, retentionMs))
    .sort((left, right) => finiteNumber(right.updatedAt || right.createdAt, 0) - finiteNumber(left.updatedAt || left.createdAt, 0))
    .slice(0, maxTasks);

  return {
    version: 1,
    savedAt: now,
    items,
  };
}

function mirrorPersistedTaskCenterSnapshotValue(value, options = {}) {
  if (!value) return null;
  try {
    const snapshot = JSON.parse(String(value));
    mirrorTaskCenterSnapshotToAsyncTaskStore(snapshot, options);
    return snapshot;
  } catch {
    return null;
  }
}

function registerTaskCenterSnapshotStoragePatch(options = {}) {
  const storage = getStorage(options);
  const storageKey = getStorageKey(options);
  if (!storage || typeof storage.setItem !== 'function') return null;
  const registration = { storage, storageKey, options };
  taskCenterSnapshotStoragePatchRegistrations.push(registration);
  try {
    if (typeof storage.removeItem === 'function') storage.removeItem(TASK_CENTER_STORAGE_PATCH_MARKER_KEY);
  } catch {}
  return registration;
}

function patchStoragePrototypeForTaskCenterSnapshot() {
  const StorageCtor = globalThis.Storage;
  const prototype = StorageCtor?.prototype;
  if (!prototype || storagePrototypePatched || typeof prototype.setItem !== 'function') return false;
  const originalSetItem = prototype.setItem;
  Object.defineProperty(prototype, 'setItem', {
    value: function patchedTaskCenterSnapshotSetItem(key, value) {
      const result = originalSetItem.call(this, key, value);
      for (const registration of taskCenterSnapshotStoragePatchRegistrations) {
        if (registration.storage === this && String(key) === registration.storageKey) {
          mirrorPersistedTaskCenterSnapshotValue(value, registration.options);
        }
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
  storagePrototypePatched = true;
  return true;
}

function patchPlainStorageForTaskCenterSnapshot(options = {}) {
  const storage = getStorage(options);
  const storageKey = getStorageKey(options);
  if (!storage || typeof storage.setItem !== 'function' || patchedPlainStorages.has(storage)) return;
  const originalSetItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    const result = originalSetItem(key, value);
    if (String(key) === storageKey) mirrorPersistedTaskCenterSnapshotValue(value, options);
    return result;
  };
  patchedPlainStorages.add(storage);
}

function patchTaskCenterSnapshotStorage(options = {}) {
  registerTaskCenterSnapshotStoragePatch(options);
  if (!patchStoragePrototypeForTaskCenterSnapshot()) patchPlainStorageForTaskCenterSnapshot(options);
}

export function persistTaskCenterSnapshot(tasks = [], options = {}) {
  const storage = getStorage(options);
  if (!storage || typeof storage.setItem !== 'function') return null;
  const now = typeof options.now === 'function' ? options.now() : finiteNumber(options.now, Date.now());
  mirrorTaskCenterTasksToAsyncTaskStore(tasks, options, now);
  const snapshot = serializeTaskCenterSnapshot(tasks, { ...options, now });
  try {
    storage.setItem(getStorageKey(options), JSON.stringify(snapshot));
    mirrorTaskCenterSnapshotToAsyncTaskStore(snapshot, options);
    return snapshot;
  } catch {
    return null;
  }
}

export function loadTaskCenterSnapshot(options = {}) {
  const storage = getStorage(options);
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const storageKey = getStorageKey(options);
    const rawValue = storage.getItem(storageKey) || '{}';
    const parsed = JSON.parse(rawValue);
    const now = finiteNumber(options.now, Date.now());
    const retentionMs = Math.max(0, finiteNumber(options.doneRetentionMs, DEFAULT_DONE_RETENTION_MS));
    const items = (Array.isArray(parsed.items) ? parsed.items : [])
      .map(sanitizeTaskCenterTask)
      .filter(Boolean)
      .map((task) => normalizeRestoredActiveTask(task, now))
      .filter((task) => shouldKeepTask(task, now, retentionMs));
    const normalizedSnapshot = {
      version: 1,
      savedAt: now,
      items,
    };
    const normalizedValue = JSON.stringify(normalizedSnapshot);
    if (typeof storage.setItem === 'function' && normalizedValue !== String(rawValue || '')) {
      storage.setItem(storageKey, normalizedValue);
      mirrorTaskCenterSnapshotToAsyncTaskStore(normalizedSnapshot, options);
    }
    return items;
  } catch {
    return [];
  }
}

function getRawTaskMap(manager) {
  if (!manager) return null;
  if (!manager.__unifiedTaskCenterPersistenceRawTasks) {
    Object.defineProperty(manager, '__unifiedTaskCenterPersistenceRawTasks', {
      value: new Map(),
      enumerable: false,
      configurable: true,
    });
  }
  return manager.__unifiedTaskCenterPersistenceRawTasks;
}

function getManagerTasks(manager) {
  const merged = new Map();
  const rawTasks = getRawTaskMap(manager);
  if (rawTasks) {
    for (const task of rawTasks.values()) {
      if (task?.taskId) merged.set(task.taskId, task);
    }
  }
  const tasks = manager?.tasks;
  if (tasks && typeof tasks.values === 'function') {
    for (const task of tasks.values()) {
      const sanitized = sanitizeTaskCenterTask(task);
      if (!sanitized) continue;
      const previous = merged.get(sanitized.taskId) || {};
      merged.set(sanitized.taskId, {
        ...previous,
        ...sanitized,
        unifiedTask: sanitized.unifiedTask || previous.unifiedTask || null,
        recoverySpec: sanitized.recoverySpec || previous.recoverySpec || null,
      });
    }
  }
  return Array.from(merged.values());
}

function patchTaskMap(manager, options = {}) {
  const tasks = manager?.tasks;
  if (!tasks || tasks.__unifiedTaskCenterPersistencePatched) return;
  const rawTasks = getRawTaskMap(manager);
  const originalDelete = typeof tasks.delete === 'function' ? tasks.delete.bind(tasks) : null;
  const originalClear = typeof tasks.clear === 'function' ? tasks.clear.bind(tasks) : null;
  if (originalDelete) {
    tasks.delete = (key) => {
      const result = originalDelete(key);
      rawTasks?.delete(key);
      persistTaskCenterSnapshot(getManagerTasks(manager), options);
      return result;
    };
  }
  if (originalClear) {
    tasks.clear = () => {
      const result = originalClear();
      rawTasks?.clear();
      persistTaskCenterSnapshot(getManagerTasks(manager), options);
      return result;
    };
  }
  Object.defineProperty(tasks, '__unifiedTaskCenterPersistencePatched', {
    value: true,
    enumerable: false,
    configurable: true,
  });
}

function restoreMediaTaskNodes(tasks, options = {}) {
  const mediaTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => ACTIVE_STATUSES.has(task.status) && isMediaTask(task));
  if (mediaTasks.length === 0 || options.restoreMediaTasks === false) return;
  if (typeof options.restoreRestoredMediaTasks === 'function') {
    void Promise.resolve().then(() => options.restoreRestoredMediaTasks(mediaTasks, options));
    return;
  }
  void import('./unifiedMediaTaskCenterBridge.js')
    .then((module) => module.restoreRestoredMediaTasks(mediaTasks, options))
    .catch(() => {});
}

export function installTaskCenterPersistence(manager, options = {}) {
  patchTaskCenterSnapshotStorage(options);
  mirrorPersistedTaskCenterSnapshotValue(getStorage(options)?.getItem?.(getStorageKey(options)), options);
  if (!manager || manager.__unifiedTaskCenterPersistenceInstalled) return manager;
  const originalUpsert = typeof manager.upsertTask === 'function' ? manager.upsertTask.bind(manager) : null;
  if (!originalUpsert) return manager;
  const rawTasks = getRawTaskMap(manager);
  patchTaskMap(manager, options);
  manager.upsertTask = (task, upsertOptions = {}) => {
    const now = typeof options.now === 'function' ? options.now() : finiteNumber(options.now, Date.now());
    mirrorTaskCenterTaskToAsyncTaskStore(task, options, now);
    const sanitized = sanitizeTaskCenterTask(task);
    const shouldRestoreObsoleteMedia = sanitized && isObsoleteMediaInterruptionTask(sanitized);
    const shouldRestoreObsoleteGeneration = sanitized && isObsoleteGenerationInterruptionTask(sanitized);
    const previousTask = sanitized ? rawTasks?.get(sanitized.taskId) || manager.tasks?.get?.(sanitized.taskId) || {} : {};
    const shouldKeepCancelledTerminal = sanitized && shouldKeepCancelledTerminalTask(previousTask, sanitized);
    const shouldKeepActiveGeneration = sanitized && shouldKeepActiveGenerationTask(previousTask, sanitized);
    const normalized = shouldKeepActiveGeneration
      ? { ...previousTask, updatedAt: finiteNumber(previousTask.updatedAt, now) }
      : (shouldKeepCancelledTerminal
        ? normalizeCancelledTerminalTask({ ...sanitized, ...previousTask, taskId: sanitized.taskId }, now)
        : (shouldRestoreObsoleteGeneration
          ? normalizeRestoredGenerationPendingTask(sanitized, now)
          : (shouldRestoreObsoleteMedia
            ? normalizeRestoredMediaTask(sanitized, now)
            : sanitized)));
    if (normalized) {
      const previous = rawTasks?.get(normalized.taskId) || {};
      rawTasks?.set(normalized.taskId, {
        ...previous,
        ...normalized,
        unifiedTask: normalized.unifiedTask || previous.unifiedTask || null,
        recoverySpec: normalized.recoverySpec || previous.recoverySpec || null,
      });
    }
    const result = originalUpsert(normalized || task, upsertOptions);
    if (shouldRestoreObsoleteMedia && normalized) restoreMediaTaskNodes([normalized], options);
    patchTaskMap(manager, options);
    persistTaskCenterSnapshot(getManagerTasks(manager), options);
    return result;
  };
  manager.persistTaskCenterSnapshot = () => persistTaskCenterSnapshot(getManagerTasks(manager), options);
  Object.defineProperty(manager, '__unifiedTaskCenterPersistenceInstalled', {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return manager;
}

function buildV2RecoveryTaskFromAsyncRecord(record = {}) {
  if (!isAsyncTaskRecordActive(record)) return null;
  const pollingSpec = asObject(record.pollingSpec || record.recoverySpec);
  const payload = asObject(record.payload || pollingSpec.payload);
  const provider = trimString(record.provider || pollingSpec.provider || payload.provider);
  const nodeId = trimString(record.nodeId || pollingSpec.targetNodeId || pollingSpec.nodeId || payload.nodeId || payload.targetNodeId);
  const runtimeTaskId = trimString(record.runtimeTaskId || pollingSpec.runtimeTaskId || payload.runtimeTaskId);
  const clientTaskId = trimString(record.clientTaskId || pollingSpec.clientTaskId || payload.clientTaskId);
  const queryableTaskId = trimString(record.queryableTaskId || record.pollingTaskId || pollingSpec.queryableTaskId || pollingSpec.pollingTaskId);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...record,
    ...pollingSpec,
    recoverySpec: pollingSpec,
    pollingSpec,
    payload,
  });
  const recoveryMode = capability.supportsLocalProxyRecovery ? 'local_proxy_poll' : capability.supportsRemotePoll ? 'remote_poll' : trimString(record.recoveryMode || pollingSpec.recoveryMode);
  if (!provider || !nodeId) return null;
  if (recoveryMode === 'local_proxy_poll' && !hasAsyncTaskLocalRecoveryCredential({ ...record, pollingSpec, payload, runtimeTaskId, clientTaskId })) return null;
  if (recoveryMode === 'remote_poll' && !queryableTaskId) return null;
  if (recoveryMode !== 'local_proxy_poll' && recoveryMode !== 'remote_poll') return null;
  const taskId = recoveryMode === 'local_proxy_poll' ? trimString(runtimeTaskId || clientTaskId) : queryableTaskId;
  if (!taskId) return null;
  const kind = resolveAsyncTaskKindFromTaskCenterTask({ ...record, recoverySpec: pollingSpec, payload });
  const taskType = kind === 'image' ? 'image-generation' : kind;
  const recoverySpec = {
    ...pollingSpec,
    kind: trimString(pollingSpec.kind) || 'generation',
    taskType,
    provider,
    recoveryMode,
    recoveryCapability: capability,
    modelId: trimString(record.modelId || pollingSpec.modelId || pollingSpec.model || payload.modelId || payload.model),
    targetNodeId: nodeId,
    taskId,
    queryableTaskId: recoveryMode === 'remote_poll' ? queryableTaskId : '',
    pollingTaskId: recoveryMode === 'remote_poll' ? queryableTaskId : '',
    runtimeTaskId,
    clientTaskId,
    remoteTaskId: trimString(record.remoteTaskId || pollingSpec.remoteTaskId),
    remoteResultId: trimString(record.remoteResultId || pollingSpec.remoteResultId),
    startedAt: finiteNumber(pollingSpec.startedAt || record.createdAt || record.updatedAt, Date.now()),
    resumable: record.canResume !== false,
    cancellable: record.canCancel === true,
    payload: { ...payload, runtimeTaskId, clientTaskId },
  };
  const unifiedKind = taskType === 'image-generation' ? 'image' : kind;
  return {
    taskId: `generation:${nodeId}:${taskId}`,
    nodeId,
    kind: `${unifiedKind}Generation`,
    status: 'processing',
    provider,
    model: recoverySpec.modelId,
    modelId: recoverySpec.modelId,
    recoveryMode,
    runtimeTaskId,
    clientTaskId,
    startedAt: recoverySpec.startedAt,
    createdAt: finiteNumber(record.createdAt, recoverySpec.startedAt),
    updatedAt: finiteNumber(record.updatedAt, recoverySpec.startedAt),
    message: record.message || '恢复中',
    recoverySpec,
    unifiedTask: {
      id: `generation:${nodeId}:${taskId}`,
      kind: unifiedKind,
      status: 'running',
      nodeId,
      provider,
      model: recoverySpec.modelId,
      recoveryMode,
      canCancel: false,
      canRetry: false,
      canResume: true,
      createdAt: finiteNumber(record.createdAt, recoverySpec.startedAt),
      updatedAt: finiteNumber(record.updatedAt, recoverySpec.startedAt),
    },
  };
}

function collectAsyncRecordV2RecoveryTasks(options = {}) {
  const records = loadAsyncTaskRecords({ ...options, storage: options.asyncTaskStorage || options.storage });
  return records.map(buildV2RecoveryTaskFromAsyncRecord).filter(Boolean);
}

function mergeV2RecoverySources(tasks = [], asyncRecordTasks = []) {
  const merged = [];
  const keys = new Set();
  for (const task of [...tasks, ...asyncRecordTasks]) {
    const recoverySpec = asObject(task.recoverySpec || task.unifiedTask?.recoverySpec);
    const key = [
      trimString(recoverySpec.targetNodeId || task.nodeId || task.unifiedTask?.nodeId),
      trimString(recoverySpec.recoveryMode || task.recoveryMode),
      trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || recoverySpec.clientTaskId || task.clientTaskId || recoverySpec.queryableTaskId || recoverySpec.pollingTaskId || recoverySpec.taskId || task.taskId),
    ].join(':');
    if (!key || keys.has(key)) continue;
    keys.add(key);
    merged.push(task);
  }
  return merged;
}

function scheduleRestoredGenerationTerminalReconcile(tasks, options = {}) {
  const terminalTasks = tasks.filter((task) => TERMINAL_STATUSES.has(task.status) && isGenerationTask(task));
  if (terminalTasks.length === 0 || options.reconcileTerminalGenerationTasks === false) return;
  const delays = Array.isArray(options.generationTerminalReconcileRetryDelays) ? options.generationTerminalReconcileRetryDelays : [0, 300, 1200, 3000];
  const run = () => {
    if (typeof options.reconcileRestoredGenerationTerminalTasks === 'function') {
      void Promise.resolve().then(() => options.reconcileRestoredGenerationTerminalTasks(terminalTasks, options));
      return;
    }
    void import('./unifiedTaskCenterGenerationRecovery.js')
      .then((module) => module.reconcileRestoredGenerationTerminalTasks(terminalTasks, options))
      .catch(() => {});
  };
  for (const delay of delays) {
    const ms = finiteNumber(delay, 0);
    if (ms <= 0) {
      run();
      continue;
    }
    const timer = setTimeout(run, ms);
    if (typeof timer?.unref === 'function') timer.unref();
  }
}

function scheduleRestoredMediaTaskRecovery(tasks, options = {}) {
  const mediaTasks = tasks.filter((task) => (ACTIVE_STATUSES.has(task.status) || TERMINAL_STATUSES.has(task.status)) && isMediaTask(task));
  if (mediaTasks.length === 0 || options.restoreMediaTasks === false) return;
  const delays = Array.isArray(options.mediaRestoreRetryDelays) ? options.mediaRestoreRetryDelays : [0, 300, 1200, 3000];
  const run = () => {
    if (typeof options.restoreRestoredMediaTasks === 'function') {
      void Promise.resolve().then(() => options.restoreRestoredMediaTasks(mediaTasks, options));
      return;
    }
    void import('./unifiedMediaTaskCenterBridge.js')
      .then((module) => module.restoreRestoredMediaTasks(mediaTasks, options))
      .catch(() => {});
  };
  for (const delay of delays) {
    const ms = finiteNumber(delay, 0);
    if (ms <= 0) {
      run();
      continue;
    }
    const timer = setTimeout(run, ms);
    if (typeof timer?.unref === 'function') timer.unref();
  }
}

export function restoreTaskCenterPersistence(manager, options = {}) {
  if (!manager || typeof manager.upsertTask !== 'function') return [];
  const tasks = loadTaskCenterSnapshot(options);
  const store = options.store || appStore;
  installAsyncTaskLoadingRecovery({
    ...options,
    asyncTaskLoadingSource: 'task-center-persistence',
    store,
  });
  const v2Enabled = options.generationRecoveryV2 !== false;
  const v2Options = {
    ...options,
    ...asObject(options.generationRecoveryV2Options),
    store,
  };
  const asyncRecordV2Tasks = v2Enabled ? collectAsyncRecordV2RecoveryTasks(v2Options) : [];
  const v2SourceTasks = v2Enabled ? mergeV2RecoverySources(tasks, asyncRecordV2Tasks) : tasks;
  const v2Tickets = v2Enabled ? buildGenerationRecoveryV2Tickets(v2SourceTasks, v2Options) : [];
  const v2Keys = new Set(v2Tickets.map((ticket) => ticket.id));
  const projectedTasks = v2Keys.size
    ? tasks.map((task) => (v2Keys.has(trimString(task.taskId || task.unifiedTask?.id))
      ? { ...task, projectionSource: 'asyncTaskRuntime', ownsRecoveryFact: false }
      : task))
    : tasks;
  const v2SessionTasks = mergeV2RecoverySources(projectedTasks, asyncRecordV2Tasks);
  const legacyTasks = v2Keys.size
    ? tasks.filter((task) => !v2Keys.has(trimString(task.taskId || task.unifiedTask?.id)))
    : tasks;
  for (const task of projectedTasks) {
    manager.upsertTask(task, { silent: true });
  }
  if (typeof manager.render === 'function') manager.render();
  const generationRecoveryV2Session = v2Tickets.length
    ? startGenerationRecoveryV2(v2SessionTasks, manager, v2Options)
    : null;
  coordinateRestoredGenerationRecovery(legacyTasks, manager, {
    ...options,
    resumeActiveTasks: v2Tickets.length ? false : options.resumeActiveTasks,
    store,
  });
  scheduleRestoredGenerationTerminalReconcile(tasks, options);
  scheduleRestoredMediaTaskRecovery(tasks, options);
  tasks.generationRecoveryV2Session = generationRecoveryV2Session;
  return tasks;
}

export const __test__ = {
  ACTIVE_STATUSES,
  DEFAULT_STORAGE_KEY,
  canResumeTask,
  normalizeRestoredActiveTask,
  sanitizeRecoverySpec,
};
