import {
  reconcileRestoredGenerationActiveTasks,
  resumeRestoredGenerationTasks,
} from './unifiedTaskCenterGenerationRecovery.js';

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

function getStoreState(store) {
  if (!store) return {};
  if (typeof store.getStateRaw === 'function') return asObject(store.getStateRaw());
  if (typeof store.getState === 'function') return asObject(store.getState());
  return asObject(store.state);
}

function getNodes(store) {
  return asObject(getStoreState(store).nodes);
}

function getRecoverySpec(task = {}) {
  return asObject(task.recoverySpec || task.unifiedTask?.recoverySpec);
}

function resolveNodeId(task = {}) {
  const recoverySpec = getRecoverySpec(task);
  return trimString(task.nodeId || task.unifiedTask?.nodeId || recoverySpec.targetNodeId || recoverySpec.sourceNodeId);
}

function resolveRemoteTaskId(task = {}) {
  const recoverySpec = getRecoverySpec(task);
  return trimString(recoverySpec.taskId || task.remoteTaskId || task.asyncTaskId || task.providerTaskId);
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

function buildNodeRecoveryTask(nodeId = '', node = {}) {
  const taskId = trimString(node.asyncTaskId);
  const provider = resolveNodeProvider(node);
  if (!nodeId || !taskId || !provider || !isActiveNodeGenerationStatus(node)) return null;
  const model = resolveNodeModel(node);
  const startedAt = resolveNodeStartedAt(node);
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
      startedAt,
      resumable: node.taskResumable !== false,
      cancellable: node.taskCancellable !== false,
      payload: {
        provider,
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
      canCancel: false,
      canRetry: false,
      canResume: true,
      createdAt: startedAt || Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function collectNodeRecoveryTasks(store, existingTasks = []) {
  const existingKeys = new Set((Array.isArray(existingTasks) ? existingTasks : [])
    .map((task) => `${resolveNodeId(task)}:${resolveRemoteTaskId(task)}`));
  const tasks = [];
  for (const [nodeId, node] of Object.entries(getNodes(store))) {
    const task = buildNodeRecoveryTask(nodeId, asObject(node));
    if (!task) continue;
    const key = `${resolveNodeId(task)}:${resolveRemoteTaskId(task)}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    tasks.push(task);
  }
  return tasks;
}

function collectRecoveryTasks(tasks = [], store = null) {
  const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(isActiveGenerationTask);
  return [...activeTasks, ...collectNodeRecoveryTasks(store, activeTasks)].filter(isActiveGenerationTask);
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
  return Boolean(recoverySpec.taskId && recoverySpec.targetNodeId);
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
  return `${trimString(task.taskId)}:${resolveNodeId(task)}:${resolveRemoteTaskId(task)}`;
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
    void Promise.resolve().then(() => options.resumeRestoredTasks(tasks, resumeOptions));
    return;
  }
  void resumeRestoredGenerationTasks(tasks, resumeOptions).catch(() => {});
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
  const initialActiveTasks = collectRecoveryTasks(snapshotTasks, store);
  if (initialActiveTasks.length === 0 && !store) return { activeTasks: [], readyResumeTasks: [] };

  const delays = Array.isArray(options.generationRecoveryRetryDelays)
    ? options.generationRecoveryRetryDelays
    : [0, 300, 1200, 3000, 8000, 15000];
  const resumeEnabled = options.resumeActiveTasks !== false;
  const reconcileEnabled = options.reconcileActiveGenerationTasks !== false;
  const maxWatchMs = Math.max(0, Number(options.generationRecoveryWatchMs ?? 30000) || 0);
  let stopped = false;
  let unsubscribe = null;
  let latestResult = { activeTasks: initialActiveTasks, readyResumeTasks: [] };

  const run = () => {
    if (stopped) return latestResult;
    const activeTasks = collectRecoveryTasks(snapshotTasks, store);
    const restorableTasks = resumeEnabled ? activeTasks.filter(canResumeTask) : [];
    if (reconcileEnabled) runActiveReconcile(activeTasks, options);
    const readyResumeTasks = pickReadyResumeTasks(restorableTasks, store, manager);
    if (readyResumeTasks.length) runResume(readyResumeTasks, manager, options);
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
    try { unsubscribe?.(); } catch {}
  } };
}

export const __test__ = {
  canResumeTask,
  getResumeKey,
  hasTargetNode,
  isActiveGenerationTask,
  pickReadyResumeTasks,
};