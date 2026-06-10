import { mergeGrsaiImageResponseMapping } from '../manifests/image/modelApi/grsaiImageResultMapping.js';
import { buildImageGenerationResultPatch, normalizeImageGenerationResult } from '../components/aigenImage/imageGenerationResultRenderer.js';
import {
  resumeAsyncImageTask,
  resumeDreaminaImageTask,
  resumeRunningHubImageTask,
} from '../../api/aiImageApi.js';
import {
  resumeAsyncVideoTask,
  resumeDreaminaVideoTask,
  resumeRunningHubVideoTask,
} from '../../api/aiVideoApi.js';
import { resumeRunningHubAudioTask } from '../../api/aiAudioApi.js';
import appStore from './stores/appStore.js';
import {
  buildGenerationCancelledPatch,
  buildGenerationFailurePatch,
  buildGenerationSuccessPatch,
  isGenerationTaskCancelledStatus,
  isGenerationTaskFailureStatus,
  isGenerationTaskTerminalStatus,
} from './generationTaskLifecycle.js';
import { resumeTask as resumeGenerationTask } from './generationTaskRuntimeTaskCenterBridge.js';

const ACTIVE_TASK_CENTER_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending', 'polling']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function resolveRecoverySpec(task = {}) {
  return asObject(task.recoverySpec || task.unifiedTask?.recoverySpec);
}

function resolveTaskType(spec = {}, task = {}) {
  const direct = normalizeLower(spec.taskType || spec.type || task.unifiedTask?.kind || task.kind);
  if (direct.includes('image')) return 'image-generation';
  if (direct.includes('video')) return 'video';
  if (direct.includes('audio')) return 'audio';
  return direct || 'provider_async';
}

function buildVideoResultPatch(result = {}) {
  const value = asObject(result);
  return {
    ...(value.videoUrl ? { videoUrl: value.videoUrl } : {}),
    ...(Array.isArray(value.videos) ? { videos: value.videos } : {}),
    ...(value.thumbUrl ? { thumbUrl: value.thumbUrl } : {}),
    ...(value.localPath ? { localPath: value.localPath } : {}),
    ...(value.displayLocalPath ? { displayLocalPath: value.displayLocalPath } : {}),
    ...(value.posterLocalPath ? { posterLocalPath: value.posterLocalPath } : {}),
    ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
    ...(value.videoProxyStatus ? { videoProxyStatus: value.videoProxyStatus } : {}),
    ...(value.saveError ? { saveError: value.saveError } : {}),
  };
}

function buildImageResultPatch(result = {}, options = {}) {
  const normalized = normalizeImageGenerationResult(result);
  return buildImageGenerationResultPatch(normalized, {
    startedAt: Number(options.startedAt || 0) || 0,
    duration: options.duration ?? null,
  }) || {};
}

function buildAudioResultPatch(result = {}) {
  const value = asObject(result);
  return {
    ...(value.audioUrl ? { audioUrl: value.audioUrl, src: value.audioUrl } : {}),
    ...(Array.isArray(value.audios) ? { audios: value.audios } : {}),
    ...(value.vocalsAudioUrl ? { vocalsAudioUrl: value.vocalsAudioUrl } : {}),
    ...(value.backgroundAudioUrl ? { backgroundAudioUrl: value.backgroundAudioUrl } : {}),
    ...(value.localPath ? { localPath: value.localPath } : {}),
  };
}

function readPathValue(source = {}, path = '') {
  const segments = trimString(path).split('.').filter(Boolean);
  if (!segments.length) return undefined;
  return segments.reduce((value, segment) => {
    if (value == null) return undefined;
    const isArraySegment = segment.endsWith('[]');
    const key = isArraySegment ? segment.slice(0, -2) : segment;
    if (Array.isArray(value)) {
      const index = Number(key);
      if (Number.isInteger(index)) return value[index];
      const mapped = value.map((item) => item?.[key]).filter((item) => item !== undefined);
      return isArraySegment ? mapped.flatMap((item) => Array.isArray(item) ? item : [item]) : mapped;
    }
    const next = value?.[key];
    if (isArraySegment) return Array.isArray(next) ? next : next === undefined ? undefined : [next];
    return next;
  }, source);
}

function flattenResultValues(value, output = []) {
  if (value == null) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => flattenResultValues(item, output));
    return output;
  }
  output.push(value);
  return output;
}

function collectMappedResultPathHits(result = {}, responseMapping = {}) {
  const resultPaths = Array.isArray(responseMapping?.resultPaths) ? responseMapping.resultPaths : [];
  const hits = [];
  for (const path of resultPaths) {
    const values = flattenResultValues(readPathValue(result, path));
    if (values.some((value) => trimString(value) || (value && typeof value === 'object'))) hits.push(path);
  }
  return hits;
}

function collectExplicitResultHits(taskType = '', patch = {}) {
  const hits = [];
  const add = (field, value) => {
    if (Array.isArray(value) ? value.length > 0 : trimString(value)) hits.push(field);
  };
  if (taskType === 'image-generation') {
    add('imageUrl', patch.imageUrl);
    add('sourceUrl', patch.sourceUrl);
    add('thumbUrl', patch.thumbUrl);
    add('localPath', patch.localPath);
    add('images', patch.images);
  } else if (taskType === 'video') {
    add('videoUrl', patch.videoUrl);
    add('sourceUrl', patch.sourceUrl);
    add('localPath', patch.localPath);
    add('videos', patch.videos);
  } else if (taskType === 'audio') {
    add('audioUrl', patch.audioUrl);
    add('src', patch.src);
    add('localPath', patch.localPath);
    add('audios', patch.audios);
  }
  return hits;
}

function hasRestoredResultAsset(taskType = '', patch = {}) {
  return collectExplicitResultHits(taskType, patch).length > 0;
}

function resolveStatusValue(result = {}) {
  const value = asObject(result);
  return trimString(
    value.status
      || value.taskStatus
      || value.task_status
      || value.state
      || value.phase
      || value.data?.status
      || value.data?.taskStatus
      || value.data?.task_status
      || value.result?.status
      || value.output?.status
  ).toLowerCase();
}

function resolvePollStrategy(provider = '', taskType = '', resumeOptions = {}) {
  const value = normalizeLower(provider);
  if (value === 'dreamina') return `${taskType}:dreamina-submit-poll`;
  if (value === 'runninghub' || value === 'runninghubwf') return `${taskType}:runninghub-poll`;
  if (taskType === 'audio') return `${taskType}:runninghub-audio-poll`;
  if (resumeOptions.taskPolling?.urlTemplate) return `${taskType}:manifest-taskPolling`;
  return `${taskType}:provider-resume`;
}

function buildRecoveryPollingTrace(recoverySpec = {}, taskType = '') {
  const resumeOptions = buildRestoredResumeOptions(recoverySpec);
  const payload = buildRestoredPayload(recoverySpec);
  const provider = normalizeLower(recoverySpec.provider || payload.provider);
  const responseMapping = asObject(resumeOptions.responseMapping);
  const taskPolling = asObject(resumeOptions.taskPolling);
  const pollingTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId);
  return {
    provider,
    modelId: trimString(recoverySpec.modelId || payload.model || payload.modelId),
    pollingTaskId,
    recoveryTaskId: pollingTaskId,
    remoteTaskId: trimString(recoverySpec.remoteTaskId || recoverySpec.resultRemoteTaskId),
    taskType,
    pollStrategy: resolvePollStrategy(provider, taskType, resumeOptions),
    pollUrlTemplate: trimString(taskPolling.urlTemplate),
    pollUrl: trimString(taskPolling.urlTemplate).replace('{taskId}', encodeURIComponent(pollingTaskId)),
    pollMethod: trimString(taskPolling.method || 'GET').toUpperCase(),
    statusPath: trimString(taskPolling.statusPath || responseMapping.statusPath),
    errorPath: trimString(taskPolling.errorPath || responseMapping.errorPath),
    resultPaths: Array.isArray(responseMapping.resultPaths) ? [...responseMapping.resultPaths] : [],
    statusValue: '',
    resultPathHit: '',
    explicitResultHit: '',
    failureReason: '',
    attempts: 0,
    updatedAt: Date.now(),
  };
}

function markRecoveryPollingTrace(trace = {}, patch = {}) {
  Object.assign(trace, {
    ...patch,
    updatedAt: Date.now(),
  });
  return trace;
}

function firstMappedResultValue(result = {}, responseMapping = {}) {
  const resultPaths = Array.isArray(responseMapping?.resultPaths) ? responseMapping.resultPaths : [];
  for (const path of resultPaths) {
    const values = flattenResultValues(readPathValue(result, path));
    const hit = values.find((value) => trimString(value) || (value && typeof value === 'object'));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function buildPatchFromMappedValue(taskType = '', value, context = {}) {
  if (value === undefined) return {};
  if (taskType === 'image-generation') return buildImageResultPatch(typeof value === 'object' ? value : { imageUrl: String(value || '') }, context);
  if (taskType === 'video') return buildVideoResultPatch(typeof value === 'object' ? value : { videoUrl: String(value || '') });
  if (taskType === 'audio') return buildAudioResultPatch(typeof value === 'object' ? value : { audioUrl: String(value || '') });
  return asObject(value);
}

function buildGuardedRestoredResultPatch(taskType = '', result = {}, context = {}, trace = {}, responseMapping = {}) {
  const resultPathHits = collectMappedResultPathHits(result, responseMapping);
  const mappedPatch = resultPathHits.length
    ? buildPatchFromMappedValue(taskType, firstMappedResultValue(result, responseMapping), context)
    : {};
  const rawPatch = buildResultPatch(taskType, result, context);
  const patch = hasRestoredResultAsset(taskType, mappedPatch) ? mappedPatch : rawPatch;
  const explicitHits = collectExplicitResultHits(taskType, patch);
  const statusValue = resolveStatusValue(result);
  markRecoveryPollingTrace(trace, {
    statusValue,
    resultPathHit: resultPathHits[0] || '',
    explicitResultHit: explicitHits[0] || '',
    failureReason: '',
  });
  if (!hasRestoredResultAsset(taskType, patch)) {
    const isStatusRefresh = trimString(trace.pollUrlTemplate || trace.pollUrl).includes('status?refresh=1');
    const reason = isStatusRefresh ? 'status-refresh-without-result' : 'terminal-status-without-result';
    markRecoveryPollingTrace(trace, { failureReason: reason });
    throw new Error('远端任务状态查询未返回可用结果，不能作为生成结果回填');
  }
  return patch;
}

function buildResultPatch(taskType, result, context = {}) {
  if (taskType === 'video') return buildVideoResultPatch(result);
  if (taskType === 'image-generation') return buildImageResultPatch(result, context);
  if (taskType === 'audio') return buildAudioResultPatch(result);
  return asObject(result);
}

function hasRecoverablePollingTaskId(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return Boolean(trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId));
}

function requiresPollingTaskIdForRecovery(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const taskType = resolveTaskType(recoverySpec, task);
  return ['image-generation', 'video', 'audio', 'text', 'provider_async'].includes(taskType) || taskType.includes('generation');
}

function canResumeRestoredTask(task = {}) {
  return !requiresPollingTaskIdForRecovery(task) || hasRecoverablePollingTaskId(task);
}

function buildGenerationLoadingPatch(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const taskType = resolveTaskType(recoverySpec, task);
  const provider = normalizeLower(recoverySpec.provider || recoverySpec.payload?.provider);
  const taskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId);
  const startedAt = getTaskAttemptTime(task) || Date.now();
  const basePatch = {
    isGenerating: true,
    jobStatus: 'loading',
    jobError: null,
    generationStartTime: startedAt,
  };

  if (taskType === 'image-generation') {
    if (provider === 'runninghub' || provider === 'runninghubwf') {
      return {
        ...basePatch,
        rhTaskId: taskId,
        rhTaskStatus: 'pending',
        rhTaskRecovering: true,
        rhTaskStartedAt: startedAt,
      };
    }
    if (provider === 'dreamina') {
      return {
        ...basePatch,
        dreaminaSubmitId: taskId,
        dreaminaTaskStatus: 'pending',
        dreaminaTaskPhase: 'generating',
        dreaminaTaskLabel: '生成中',
        dreaminaTaskRecovering: true,
        dreaminaTaskStartedAt: startedAt,
      };
    }
    return {
      ...basePatch,
      asyncTaskId: taskId,
      asyncTaskProvider: provider,
      asyncTaskKind: 'image',
      asyncTaskStatus: 'pending',
      asyncTaskRecovering: true,
      asyncTaskStartedAt: startedAt,
    };
  }

  return basePatch;
}

function isRestoredGenerationActiveStatus(status) {
  return ACTIVE_TASK_CENTER_STATUSES.has(normalizeLower(status));
}

function isRestoredGenerationInterruptedStatus(status) {
  return normalizeLower(status) === 'interrupted';
}

function buildGenerationInterruptedPatch() {
  return {
    isGenerating: false,
    jobStatus: 'idle',
    jobError: null,
  };
}

function buildGenerationTerminalPatch(task = {}) {
  const status = task.status || task.unifiedTask?.status;
  const error = trimString(task.error || task.unifiedTask?.error?.message);
  if (isRestoredGenerationInterruptedStatus(status)) return buildGenerationInterruptedPatch();
  if (isGenerationTaskFailureStatus(status)) return buildGenerationFailurePatch({ error: error || '任务失败' });
  if (isGenerationTaskCancelledStatus(status)) return buildGenerationCancelledPatch({ status: 'cancelled', message: task.message || '状态: 已取消' });
  return buildGenerationSuccessPatch({});
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

function resolveGenerationNodeId(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return trimString(task.nodeId || task.unifiedTask?.nodeId || recoverySpec.targetNodeId || recoverySpec.sourceNodeId);
}

function collectNodeRecoveryTaskIds(node = {}) {
  return [
    node.asyncTaskId,
    node.pollingTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
    node.remoteTaskId,
  ].map(trimString).filter(Boolean);
}

function getTaskAttemptTime(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return Number(recoverySpec.startedAt || task.startedAt || task.createdAt || task.updatedAt || 0) || 0;
}

function getNodeAttemptTime(node = {}) {
  return Number(
    node.generationStartTime
      || node.rhTaskStartedAt
      || node.asyncTaskStartedAt
      || node.dreaminaTaskStartedAt
      || 0
  ) || 0;
}

function isSameOrUntrackedGenerationTask(task = {}, node = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const restoredPollingTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId || task.remoteTaskId);
  const nodeRecoveryTaskIds = collectNodeRecoveryTaskIds(node);
  if (restoredPollingTaskId && nodeRecoveryTaskIds.length) return nodeRecoveryTaskIds.includes(restoredPollingTaskId);
  const taskAttemptTime = getTaskAttemptTime(task);
  const nodeAttemptTime = getNodeAttemptTime(node);
  if (taskAttemptTime && nodeAttemptTime && nodeAttemptTime > taskAttemptTime) return false;
  return node.isGenerating === true || trimString(node.jobStatus) === 'loading';
}

function canRestoreActiveGenerationTaskToNode(task = {}, node = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const restoredPollingTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId || task.remoteTaskId);
  const nodeRecoveryTaskIds = collectNodeRecoveryTaskIds(node);
  if (restoredPollingTaskId && nodeRecoveryTaskIds.length && !nodeRecoveryTaskIds.includes(restoredPollingTaskId)) return false;
  const taskAttemptTime = getTaskAttemptTime(task);
  const nodeAttemptTime = getNodeAttemptTime(node);
  if (taskAttemptTime && nodeAttemptTime && nodeAttemptTime > taskAttemptTime) return false;
  return true;
}

function isRestoredGenerationTask(task = {}) {
  const kind = normalizeLower(task.kind);
  const unifiedKind = normalizeLower(task.unifiedTask?.kind);
  const taskId = trimString(task.taskId);
  return kind.includes('generation')
    || unifiedKind === 'image'
    || unifiedKind === 'video'
    || unifiedKind === 'audio'
    || unifiedKind === 'provider_async'
    || taskId.startsWith('generation:');
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

function isRestoredGenerationTerminalStatus(status) {
  const normalized = normalizeLower(status);
  return normalized !== 'idle' && (isGenerationTaskTerminalStatus(normalized) || isRestoredGenerationInterruptedStatus(normalized));
}

export function reconcileRestoredGenerationTerminalTasks(tasks = [], options = {}) {
  const store = options.store || appStore;
  const nodes = getNodes(store);
  const reconciled = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const status = task?.status || task?.unifiedTask?.status;
    if (!isRestoredGenerationTerminalStatus(status)) continue;
    const nodeId = resolveGenerationNodeId(task);
    const node = asObject(nodes[nodeId]);
    if (!nodeId || !node.id && !nodes[nodeId]) continue;
    if (!isSameOrUntrackedGenerationTask(task, { id: nodeId, ...node })) continue;
    applyNodePatch(store, [nodeId], buildGenerationTerminalPatch(task));
    reconciled.push({ taskId: task.taskId, nodeId });
  }
  return reconciled;
}

export function reconcileRestoredGenerationActiveTasks(tasks = [], options = {}) {
  const store = options.store || appStore;
  const nodes = getNodes(store);
  const reconciled = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const status = task?.status || task?.unifiedTask?.status;
    if (!isRestoredGenerationActiveStatus(status) || !isRestoredGenerationTask(task)) continue;
    if (!canResumeRestoredTask(task)) continue;
    const nodeId = resolveGenerationNodeId(task);
    const node = asObject(nodes[nodeId]);
    if (!nodeId || !node.id && !nodes[nodeId]) continue;
    if (!canRestoreActiveGenerationTaskToNode(task, { id: nodeId, ...node })) continue;
    applyNodePatch(store, [nodeId], buildGenerationLoadingPatch(task));
    reconciled.push({ taskId: task.taskId, nodeId });
  }
  return reconciled;
}

function buildRestoredPayload(recoverySpec = {}) {
  const payload = asObject(recoverySpec.payload);
  const provider = trimString(payload.provider || recoverySpec.provider);
  const model = trimString(payload.model || payload.modelId || recoverySpec.modelId || recoverySpec.model);
  return {
    ...payload,
    ...(provider ? { provider } : {}),
    ...(model ? { model, modelId: trimString(payload.modelId || recoverySpec.modelId || model) } : {}),
    ...(trimString(payload.adapterType || recoverySpec.adapterType) ? { adapterType: trimString(payload.adapterType || recoverySpec.adapterType) } : {}),
    ...(trimString(payload.executionId || recoverySpec.executionId) ? { executionId: trimString(payload.executionId || recoverySpec.executionId) } : {}),
  };
}

function buildRestoredResumeOptions(recoverySpec = {}) {
  const payload = asObject(recoverySpec.payload);
  const taskMeta = asObject(recoverySpec.taskMeta);
  const provider = normalizeLower(recoverySpec.provider || payload.provider || taskMeta.provider);
  const baseOptions = {
    ...taskMeta,
    ...(!taskMeta.taskPolling && payload.taskPolling ? { taskPolling: payload.taskPolling } : {}),
    ...(!taskMeta.responseMapping && payload.responseMapping ? { responseMapping: payload.responseMapping } : {}),
    ...(!taskMeta.useOpenapiQuery && payload.useOpenapiQuery !== undefined ? { useOpenapiQuery: payload.useOpenapiQuery } : {}),
  };
  if (provider === 'grsai') {
    return {
      ...baseOptions,
      responseMapping: mergeGrsaiImageResponseMapping(baseOptions.responseMapping),
    };
  }
  return baseOptions;
}

function createPollFunction(recoverySpec = {}, taskType = '') {
  const payload = buildRestoredPayload(recoverySpec);
  const provider = normalizeLower(recoverySpec.provider || payload.provider);
  const resumeOptions = buildRestoredResumeOptions(recoverySpec);

  if (taskType === 'video') {
    if (provider === 'runninghubwf') {
      return ({ taskId, signal }) => resumeRunningHubVideoTask(taskId, payload, { ...resumeOptions, signal });
    }
    if (provider === 'dreamina') {
      return ({ taskId, signal }) => resumeDreaminaVideoTask(taskId, { ...payload, signal });
    }
    return ({ taskId, signal }) => resumeAsyncVideoTask(taskId, payload, { ...resumeOptions, signal });
  }

  if (taskType === 'image-generation') {
    if (provider === 'runninghub' || provider === 'runninghubwf') {
      return ({ taskId, signal }) => resumeRunningHubImageTask(taskId, payload, { ...resumeOptions, signal });
    }
    if (provider === 'dreamina') {
      return ({ taskId, signal }) => resumeDreaminaImageTask(taskId, payload, { ...resumeOptions, signal });
    }
    return ({ taskId, signal }) => resumeAsyncImageTask(taskId, payload, { ...resumeOptions, signal });
  }

  if (taskType === 'audio') {
    return ({ taskId, signal }) => resumeRunningHubAudioTask(taskId, payload, { ...resumeOptions, signal });
  }

  return null;
}

export function buildRestoredGenerationSpec(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const targetNodeId = trimString(recoverySpec.targetNodeId || task.nodeId);
  const taskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId);
  if (!targetNodeId || !taskId) return null;

  const taskType = resolveTaskType(recoverySpec, task);
  const payload = buildRestoredPayload(recoverySpec);
  const poll = createPollFunction(recoverySpec, taskType);
  if (typeof poll !== 'function') return null;
  const recoveryPollingTrace = buildRecoveryPollingTrace(recoverySpec, taskType);
  const resumeOptions = buildRestoredResumeOptions(recoverySpec);

  return {
    sourceNodeId: trimString(recoverySpec.sourceNodeId) || targetNodeId,
    targetNodeId,
    taskId,
    taskType,
    provider: trimString(recoverySpec.provider),
    adapterType: trimString(recoverySpec.adapterType) || 'modelApi',
    modelId: trimString(recoverySpec.modelId),
    executionId: trimString(recoverySpec.executionId) || `restore.${taskType}`,
    payload,
    taskMeta: {
      ...asObject(recoverySpec.taskMeta),
      recoveryPollingTrace,
    },
    recoveryPollingTrace,
    startedAt: Number(recoverySpec.startedAt || task.startedAt || task.createdAt || 0) || Date.now(),
    cancellable: recoverySpec.cancellable !== false,
    resumable: true,
    taskCenterVisibility: 'visible',
    poll: async (pollContext = {}) => {
      markRecoveryPollingTrace(recoveryPollingTrace, { attempts: Number(recoveryPollingTrace.attempts || 0) + 1 });
      try {
        const result = await poll(pollContext);
        markRecoveryPollingTrace(recoveryPollingTrace, {
          statusValue: resolveStatusValue(result),
          resultPathHit: collectMappedResultPathHits(result, resumeOptions.responseMapping)[0] || '',
        });
        return result;
      } catch (error) {
        markRecoveryPollingTrace(recoveryPollingTrace, { failureReason: trimString(error?.message) || 'poll-failed' });
        throw error;
      }
    },
    resultBuilder: (result, context = {}) => buildGuardedRestoredResultPatch(taskType, result, {
      ...asObject(context),
      startedAt: Number(context?.startedAt || recoverySpec.startedAt || task.startedAt || task.createdAt || 0) || 0,
    }, recoveryPollingTrace, resumeOptions.responseMapping),
  };
}

export async function resumeRestoredGenerationTask(task = {}, options = {}) {
  if (!canResumeRestoredTask(task)) {
    const message = '刷新前未取得远端任务 ID，生成已中断，请重新生成';
    options.taskCenterManager?.upsertTask?.({
      ...task,
      status: 'interrupted',
      message,
      error: '',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      unifiedTask: task.unifiedTask ? {
        ...task.unifiedTask,
        status: 'interrupted',
        canCancel: false,
        canRetry: false,
        canResume: false,
        error: null,
      } : null,
    });
    return { ok: false, status: 'interrupted', error: new Error(message) };
  }
  const spec = buildRestoredGenerationSpec(task);
  if (!spec) {
    const message = '生成状态恢复中';
    options.taskCenterManager?.upsertTask?.({
      ...task,
      status: 'processing',
      message,
      error: '',
      finishedAt: 0,
      updatedAt: Date.now(),
      unifiedTask: task.unifiedTask ? {
        ...task.unifiedTask,
        status: 'running',
        canCancel: false,
        canRetry: false,
        canResume: false,
        error: null,
      } : null,
    });
    return { ok: false, status: 'processing', error: new Error(message) };
  }

  const resumeTaskFn = options.resumeTaskFn || resumeGenerationTask;
  return resumeTaskFn(spec, options);
}

export async function resumeRestoredGenerationTasks(tasks = [], options = {}) {
  const items = Array.isArray(tasks) ? tasks : [];
  const results = [];
  for (const task of items) {
    const resultPromise = resumeRestoredGenerationTask(task, options)
      .catch((error) => ({ ok: false, status: 'failed', error }));
    results.push(resultPromise);
  }
  return Promise.all(results);
}

export const __test__ = {
  buildAudioResultPatch,
  buildGuardedRestoredResultPatch,
  buildImageResultPatch,
  buildRecoveryPollingTrace,
  buildResultPatch,
  buildVideoResultPatch,
  buildRestoredGenerationSpec,
  buildRestoredResumeOptions,
  collectMappedResultPathHits,
  createPollFunction,
  hasRestoredResultAsset,
};
