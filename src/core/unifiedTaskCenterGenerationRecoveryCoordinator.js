import {
  reconcileRestoredGenerationActiveTasks,
  resumeRestoredGenerationTasks,
} from './unifiedTaskCenterGenerationRecovery.js';
import { isAsyncTaskRecordActive, loadAsyncTaskRecords } from './asyncTaskStore.js';
import {
  hasAsyncTaskLocalRecoveryCredential,
  resolveAsyncTaskLocalRecoveryTaskId,
  resolveAsyncTaskQueryableTaskId,
  resolveAsyncTaskRecoveryCapability,
} from './asyncTaskRecoveryCapabilities.js';

const ACTIVE_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending', 'polling']);
const GENERATION_KINDS = new Set(['imageGeneration', 'videoGeneration', 'audioGeneration', 'providerAsyncGeneration']);

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
      const nodeData = getNodeData(item);
      const nodeId = trimString(item.id || item.nodeId || nodeData.id || nodeData.nodeId);
      if (nodeId) map[nodeId] = { ...nodeData, ...item, data: asObject(item.data) };
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

function getRecoverySpec(task = {}) {
  return asObject(task.recoverySpec || task.unifiedTask?.recoverySpec);
}

function resolveNodeId(task = {}) {
  const recoverySpec = getRecoverySpec(task);
  return trimString(task.nodeId || task.unifiedTask?.nodeId || recoverySpec.targetNodeId || recoverySpec.sourceNodeId);
}

function resolvePollingTaskId(task = {}) {
  const recoverySpec = getRecoverySpec(task);
  return trimString(
    recoverySpec.taskId
      || recoverySpec.pollingTaskId
      || recoverySpec.recoveryTaskId
      || recoverySpec.queryableTaskId
      || task.queryableTaskId
      || task.pollingTaskId
      || task.recoveryTaskId
      || task.asyncTaskId
      || task.providerTaskId
      || recoverySpec.runtimeTaskId
      || task.runtimeTaskId
      || recoverySpec.clientTaskId
      || task.clientTaskId
  );
}

function getCanonicalRecoveryTaskKey(task = {}) {
  if (!task || typeof task !== 'object') return '';
  const nodeId = resolveNodeId(task);
  const recoverySpec = getRecoverySpec(task);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...task,
    ...recoverySpec,
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
  if (capability.supportsLocalProxyRecovery) {
    const runtimeTaskId = trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || recoverySpec.payload?.runtimeTaskId);
    const clientTaskId = trimString(recoverySpec.clientTaskId || task.clientTaskId || recoverySpec.payload?.clientTaskId);
    return `${nodeId}:local:${runtimeTaskId || clientTaskId}`;
  }
  return `${nodeId}:remote:${resolvePollingTaskId(task)}`;
}

function normalizeRecoveryTaskIdentity(task = {}) {
  if (!task || typeof task !== 'object') return null;
  const recoverySpec = getRecoverySpec(task);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...task,
    ...recoverySpec,
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
  if (!capability.supportsLocalProxyRecovery) return task;
  const payload = asObject(recoverySpec.payload);
  const runtimeTaskId = trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || payload.runtimeTaskId);
  const clientTaskId = trimString(recoverySpec.clientTaskId || task.clientTaskId || payload.clientTaskId);
  if (!runtimeTaskId && !clientTaskId) return task;
  const nextRecoverySpec = {
    ...recoverySpec,
    recoveryMode: 'local_proxy_poll',
    recoveryCapability: capability,
    taskId: runtimeTaskId || clientTaskId,
    queryableTaskId: '',
    pollingTaskId: '',
    runtimeTaskId,
    clientTaskId,
    taskMeta: stripLocalProxyRemotePollingOptions(recoverySpec.taskMeta),
    payload: { ...stripLocalProxyRemotePollingOptions(payload), runtimeTaskId, clientTaskId },
  };
  return {
    ...task,
    recoveryMode: 'local_proxy_poll',
    runtimeTaskId: runtimeTaskId || task.runtimeTaskId,
    clientTaskId: clientTaskId || task.clientTaskId,
    recoverySpec: nextRecoverySpec,
    unifiedTask: task.unifiedTask ? {
      ...task.unifiedTask,
      recoveryMode: 'local_proxy_poll',
      recoverySpec: nextRecoverySpec,
    } : task.unifiedTask,
  };
}

function resolveNodeProvider(node = {}) {
  return trimString(node.asyncTaskProvider || node.taskProvider || node.provider);
}

function resolveNodeModel(node = {}) {
  return trimString(node.taskModelId || node.modelId || node.model || node.selectedModel);
}

function resolveNodeStartedAt(node = {}) {
  return Number(node.asyncTaskStartedAt || node.generationStartTime || node.taskStartedAt || 0) || 0;
}

function isActiveNodeGenerationStatus(node = {}) {
  const status = normalizeLower(node.asyncTaskStatus || node.rhTaskStatus || node.dreaminaTaskStatus || node.jobStatus || node.status);
  return node.isGenerating === true || ACTIVE_STATUSES.has(status) || status === 'loading';
}

function isGrsaiLocalRuntimeTaskId(value = '') {
  const text = trimString(value).toLowerCase();
  return text.startsWith('async:image:grsai:') || text.startsWith('async:grsai:') || text.includes(':grsai:');
}

function buildNodeRecoveryTask(nodeId = '', node = {}) {
  const provider = resolveNodeProvider(node);
  const providerKey = normalizeLower(provider);
  const legacyGrsaiRuntimeTaskId = providerKey === 'grsai' && isGrsaiLocalRuntimeTaskId(node.asyncTaskId)
    ? node.asyncTaskId
    : '';
  const runtimeTaskId = trimString(node.asyncRuntimeTaskId || node.runtimeTaskId || legacyGrsaiRuntimeTaskId);
  const clientTaskId = trimString(node.asyncClientTaskId || node.clientTaskId);
  const remoteTaskId = trimString(node.asyncTaskId);
  const taskId = providerKey === 'grsai' ? runtimeTaskId : remoteTaskId;
  if (!nodeId || !taskId || !provider || !isActiveNodeGenerationStatus(node)) return null;
  const model = resolveNodeModel(node);
  const startedAt = resolveNodeStartedAt(node);
  const recoveryMode = providerKey === 'grsai' ? 'local_proxy_poll' : 'remote_poll';
  return {
    taskId: `generation:${nodeId}`,
    nodeId,
    kind: 'imageGeneration',
    status: 'processing',
    startedAt,
    createdAt: startedAt || Date.now(),
    updatedAt: Date.now(),
    message: node.statusMessage || node.rhStatusMessage || '恢复中',
    recoverySpec: {
      kind: 'generation',
      taskType: 'image-generation',
      provider,
      adapterType: trimString(node.taskAdapterType) || 'modelApi',
      modelId: model,
      executionId: trimString(node.taskExecutionId),
      sourceNodeId: trimString(node.sourceNodeId || node.parentNodeId),
      targetNodeId: nodeId,
      taskId,
      queryableTaskId: providerKey === 'grsai' ? '' : taskId,
      pollingTaskId: providerKey === 'grsai' ? '' : taskId,
      runtimeTaskId,
      clientTaskId,
      recoveryMode,
      startedAt,
      resumable: node.taskResumable !== false,
      cancellable: node.taskCancellable !== false,
      payload: {
        provider,
        ...(runtimeTaskId ? { runtimeTaskId } : {}),
        ...(clientTaskId ? { clientTaskId } : {}),
        ...(model ? { model, modelId: model } : {}),
        ...(trimString(node.taskAdapterType) ? { adapterType: trimString(node.taskAdapterType) } : {}),
        ...(trimString(node.taskExecutionId) ? { executionId: trimString(node.taskExecutionId) } : {}),
      },
      taskMeta: {
        provider,
      },
    },
    unifiedTask: {
      id: `generation:${nodeId}`,
      kind: 'image',
      status: 'running',
      nodeId,
      provider,
      model,
      recoveryMode,
      canCancel: false,
      canRetry: false,
      canResume: true,
      createdAt: startedAt || Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function resolveRecordTaskType(record = {}) {
  const kind = normalizeLower(record.kind || record.pollingSpec?.taskType || record.pollingSpec?.kind);
  if (kind.includes('video')) return 'video';
  if (kind.includes('audio')) return 'audio';
  if (kind.includes('image')) return 'image-generation';
  if (kind.includes('text') || kind.includes('chat') || kind.includes('llm')) return 'text';
  return kind || 'provider_async';
}

function buildRecordRecoveryTask(record = {}) {
  if (!isAsyncTaskRecordActive(record)) return null;
  const capability = resolveAsyncTaskRecoveryCapability(record);
  const queryableTaskId = resolveAsyncTaskQueryableTaskId(record);
  const localRecoveryTaskId = resolveAsyncTaskLocalRecoveryTaskId(record);
  const runtimeTaskId = trimString(record.runtimeTaskId || record.pollingSpec?.runtimeTaskId || record.payload?.runtimeTaskId || localRecoveryTaskId);
  const clientTaskId = trimString(record.clientTaskId || record.pollingSpec?.clientTaskId || record.payload?.clientTaskId);
  const recoveryMode = capability.supportsRemotePoll ? 'remote_poll' : capability.supportsLocalProxyRecovery ? 'local_proxy_poll' : 'none';
  const taskId = capability.supportsRemotePoll ? queryableTaskId : trimString(localRecoveryTaskId || runtimeTaskId || clientTaskId);
  const nodeId = trimString(record.nodeId || record.pollingSpec?.targetNodeId || record.pollingSpec?.sourceNodeId);
  const provider = trimString(record.provider || record.pollingSpec?.provider || record.payload?.provider || capability.provider);
  if (!taskId || !nodeId || !provider) return null;
  if (capability.supportsRemotePoll && !queryableTaskId) return null;
  if (capability.supportsLocalProxyRecovery && !hasAsyncTaskLocalRecoveryCredential(record)) return null;
  const taskType = resolveRecordTaskType(record);
  const startedAt = Number(record.pollingSpec?.startedAt || record.createdAt || record.updatedAt || 0) || 0;
  const recoverySpec = {
    ...asObject(record.pollingSpec),
    kind: trimString(record.pollingSpec?.kind) || 'generation',
    taskType,
    provider,
    recoveryMode,
    recoveryCapability: capability,
    adapterType: trimString(record.pollingSpec?.adapterType) || 'modelApi',
    modelId: trimString(record.modelId || record.pollingSpec?.modelId || record.payload?.model || record.payload?.modelId),
    sourceNodeId: trimString(record.sourceNodeId || record.pollingSpec?.sourceNodeId),
    targetNodeId: nodeId,
    taskId,
    queryableTaskId,
    pollingTaskId: queryableTaskId,
    runtimeTaskId,
    clientTaskId,
    remoteTaskId: trimString(record.remoteTaskId),
    remoteResultId: trimString(record.remoteResultId),
    startedAt,
    resumable: record.canResume !== false,
    cancellable: record.canCancel === true,
    payload: { ...asObject(record.payload), ...asObject(record.pollingSpec?.payload), runtimeTaskId, clientTaskId },
  };
  const unifiedKind = taskType === 'image-generation' ? 'image' : taskType;
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
    startedAt,
    createdAt: startedAt || record.createdAt || Date.now(),
    updatedAt: record.updatedAt || Date.now(),
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
      createdAt: startedAt || record.createdAt || Date.now(),
      updatedAt: record.updatedAt || Date.now(),
    },
  };
}

function collectAsyncTaskStoreRecoveryTasks(options = {}, existingTasks = []) {
  const existingKeys = new Set((Array.isArray(existingTasks) ? existingTasks : [])
    .map(getCanonicalRecoveryTaskKey));
  const records = loadAsyncTaskRecords({ ...options, storage: options.asyncTaskStorage || options.storage });
  const tasks = [];
  for (const record of records) {
    const task = normalizeRecoveryTaskIdentity(buildRecordRecoveryTask(record));
    if (!task) continue;
    const key = getCanonicalRecoveryTaskKey(task);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    tasks.push(task);
  }
  return tasks;
}

function collectNodeRecoveryTasks(store, existingTasks = []) {
  const existingKeys = new Set((Array.isArray(existingTasks) ? existingTasks : [])
    .map(getCanonicalRecoveryTaskKey));
  const tasks = [];
  for (const [nodeId, node] of Object.entries(getNodes(store))) {
    const task = normalizeRecoveryTaskIdentity(buildNodeRecoveryTask(nodeId, getNodeData(node)));
    if (!task) continue;
    const key = getCanonicalRecoveryTaskKey(task);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    tasks.push(task);
  }
  return tasks;
}

function collectRecoveryTasks(tasks = [], store = null, options = {}) {
  const activeTasks = (Array.isArray(tasks) ? tasks : [])
    .map(normalizeRecoveryTaskIdentity)
    .filter(Boolean)
    .filter(isActiveGenerationTask);
  const asyncStoreTasks = collectAsyncTaskStoreRecoveryTasks(options, activeTasks);
  return [
    ...activeTasks,
    ...asyncStoreTasks,
    ...collectNodeRecoveryTasks(store, [...activeTasks, ...asyncStoreTasks]),
  ].filter(isActiveGenerationTask);
}

function isGenerationTask(task = {}) {
  const kind = trimString(task.kind);
  const unifiedKind = trimString(task.unifiedTask?.kind);
  const taskId = trimString(task.taskId);
  return GENERATION_KINDS.has(kind)
    || unifiedKind === 'image'
    || unifiedKind === 'video'
    || unifiedKind === 'audio'
    || unifiedKind === 'provider_async'
    || taskId.startsWith('generation:');
}

function isActiveGenerationTask(task = {}) {
  const status = trimString(task.status || task.unifiedTask?.status);
  return ACTIVE_STATUSES.has(status) && isGenerationTask(task);
}

function canResumeTask(task = {}) {
  const recoverySpec = getRecoverySpec(task);
  const capability = resolveAsyncTaskRecoveryCapability({
    ...task,
    ...recoverySpec,
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
  if (!recoverySpec.targetNodeId) return false;
  if (capability.supportsRemotePoll) {
    return Boolean(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || recoverySpec.queryableTaskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId);
  }
  if (capability.supportsLocalProxyRecovery) {
    return Boolean(recoverySpec.runtimeTaskId || recoverySpec.clientTaskId || task.runtimeTaskId || task.clientTaskId);
  }
  return false;
}

function hasTargetNode(task = {}, store) {
  const nodeId = resolveNodeId(task);
  return Boolean(nodeId && getNodes(store)[nodeId]);
}

function getResumeRegistry(manager) {
  if (!manager) return null;
  if (!manager.__unifiedGenerationRecoveryResumeKeys) {
    Object.defineProperty(manager, '__unifiedGenerationRecoveryResumeKeys', {
      value: new Set(),
      enumerable: false,
      configurable: true,
    });
  }
  return manager.__unifiedGenerationRecoveryResumeKeys;
}

function getResumeKey(task = {}) {
  return `${trimString(task.taskId)}:${getCanonicalRecoveryTaskKey(task)}`;
}

function pickReadyResumeTasks(tasks = [], store, manager) {
  const registry = getResumeRegistry(manager);
  return tasks.filter((task) => {
    if (!canResumeTask(task) || !hasTargetNode(task, store)) return false;
    const key = getResumeKey(task);
    if (!key || registry?.has(key)) return false;
    registry?.add(key);
    return true;
  });
}

function runActiveReconcile(tasks = [], options = {}) {
  if (typeof options.reconcileRestoredGenerationActiveTasks === 'function') {
    void Promise.resolve().then(() => options.reconcileRestoredGenerationActiveTasks(tasks, options));
    return;
  }
  reconcileRestoredGenerationActiveTasks(tasks, options);
}

function runResume(tasks = [], manager, options = {}) {
  const resumeOptions = { ...options, taskCenterManager: manager };
  if (typeof options.resumeRestoredTasks === 'function') {
    void Promise.resolve()
      .then(() => options.resumeRestoredTasks(tasks, resumeOptions))
      .then((results) => options.onResumeResults?.(tasks, results))
      .catch(() => {});
    return;
  }
  void resumeRestoredGenerationTasks(tasks, resumeOptions)
    .then((results) => options.onResumeResults?.(tasks, results))
    .catch(() => {});
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

export function coordinateRestoredGenerationRecovery(tasks = [], manager, options = {}) {
  const store = options.store;
  const snapshotTasks = Array.isArray(tasks) ? tasks : [];
  const initialActiveTasks = collectRecoveryTasks(snapshotTasks, store, options);
  if (initialActiveTasks.length === 0 && !store) return { activeTasks: [], readyResumeTasks: [] };

  const delays = Array.isArray(options.generationRecoveryRetryDelays)
    ? options.generationRecoveryRetryDelays
    : [0, 300, 1200, 3000, 8000, 15000];
  const resumeEnabled = options.resumeActiveTasks !== false;
  const reconcileEnabled = options.reconcileActiveGenerationTasks !== false;
  const maxWatchMs = Math.max(0, Number(options.generationRecoveryWatchMs ?? 30000) || 0);
  let stopped = false;
  let unsubscribe = null;
  let pendingRetryTimer = null;
  let latestResult = { activeTasks: initialActiveTasks, readyResumeTasks: [] };
  const pendingRetryMs = Math.max(500, Number(options.generationRecoveryPollIntervalMs ?? 3000) || 3000);

  const schedulePendingRetry = (tasksForResume = [], results = []) => {
    if (stopped) return;
    const items = Array.isArray(results) ? results : [];
    const registry = getResumeRegistry(manager);
    let shouldRetry = false;
    items.forEach((result, index) => {
      const status = normalizeLower(result?.status);
      if (result?.pending === true || status === 'pending' || status === 'running' || status === 'polling') {
        registry?.delete(getResumeKey(tasksForResume[index]));
        shouldRetry = true;
      }
    });
    if (!shouldRetry) return;
    if (pendingRetryTimer) clearTimeout(pendingRetryTimer);
    pendingRetryTimer = setTimeout(() => {
      pendingRetryTimer = null;
      run();
    }, pendingRetryMs);
    if (typeof pendingRetryTimer?.unref === 'function') pendingRetryTimer.unref();
  };

  const run = () => {
    if (stopped) return latestResult;
    const activeTasks = collectRecoveryTasks(snapshotTasks, store, options);
    const restorableTasks = resumeEnabled ? activeTasks.filter(canResumeTask) : [];
    if (reconcileEnabled) runActiveReconcile(activeTasks, options);
    const readyResumeTasks = pickReadyResumeTasks(restorableTasks, store, manager);
    if (readyResumeTasks.length) runResume(readyResumeTasks, manager, {
      ...options,
      onResumeResults: schedulePendingRetry,
    });
    latestResult = { activeTasks, readyResumeTasks };
    return latestResult;
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

  unsubscribe = subscribeStoreNodes(store, run);
  if (unsubscribe && maxWatchMs > 0) {
    const timer = setTimeout(() => {
      stopped = true;
      try { unsubscribe?.(); } catch {}
    }, maxWatchMs);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  return { activeTasks: latestResult.activeTasks, readyResumeTasks: latestResult.readyResumeTasks, stop: () => {
    stopped = true;
    if (pendingRetryTimer) clearTimeout(pendingRetryTimer);
    try { unsubscribe?.(); } catch {}
  } };
}

export const __test__ = {
  buildNodeRecoveryTask,
  buildRecordRecoveryTask,
  canResumeTask,
  collectAsyncTaskStoreRecoveryTasks,
  collectRecoveryTasks,
  getCanonicalRecoveryTaskKey,
  getResumeKey,
  hasTargetNode,
  isActiveGenerationTask,
  normalizeRecoveryTaskIdentity,
  pickReadyResumeTasks,
};
