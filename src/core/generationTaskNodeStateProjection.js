import {
  buildGenerationCancelledPatch,
  buildGenerationFailurePatch,
  buildGenerationStartPatch,
  buildGenerationSuccessPatch,
  isGenerationTaskCancelledStatus,
  isGenerationTaskFailureStatus,
} from './generationTaskLifecycle.js';

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

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function resolveRecoverySpec(task = {}) {
  return asObject(task.recoverySpec || task.unifiedTask?.recoverySpec || task.pollingSpec);
}

function resolveTaskType(recoverySpec = {}, task = {}) {
  const direct = normalizeLower(recoverySpec.taskType || recoverySpec.type || task.unifiedTask?.kind || task.kind);
  if (direct.includes('image')) return 'image-generation';
  if (direct.includes('video')) return 'video';
  if (direct.includes('audio')) return 'audio';
  return direct || 'provider_async';
}

function resolveRecoveryMode(recoverySpec = {}, task = {}) {
  return normalizeLower(recoverySpec.recoveryMode || task.recoveryMode || task.recoveryCapability?.recoveryMode);
}

function getTaskAttemptTime(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return Number(recoverySpec.startedAt || task.startedAt || task.createdAt || task.updatedAt || 0) || 0;
}

function isInterruptedStatus(status) {
  return normalizeLower(status) === 'interrupted';
}

function buildInterruptedPatch() {
  return {
    isGenerating: false,
    jobStatus: 'idle',
    jobError: null,
  };
}

function buildFailedImageResultClearPatch() {
  return {
    imageUrl: null,
    sourceUrl: null,
    thumbUrl: null,
    localPath: null,
    displayLocalPath: null,
    mediaUrl: null,
    images: [],
  };
}

function resolveFailureStatusCode(error = '') {
  const message = trimString(error);
  const explicitCode = message.match(/(?:错误码|error\s*code|status\s*code)\s*[:：]\s*(\d{3,5})/i)?.[1];
  const bracketedCode = message.match(/\b([45]\d{2})\b/)?.[1];
  const code = Number(explicitCode || bracketedCode || 400);
  return Number.isFinite(code) && code > 0 ? code : 400;
}

function buildFailedStatusCardPatch(error = '') {
  const message = trimString(error) || '任务失败';
  return {
    rhStatusCode: resolveFailureStatusCode(message),
    rhStatusMessage: message,
    rhTaskStatus: 'failed',
    rhTaskLabel: '生成失败',
    dreaminaTaskStatus: 'failed',
    dreaminaTaskPhase: 'failed',
    dreaminaTaskLabel: '生成失败',
  };
}

function buildRunningProjection(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const taskType = resolveTaskType(recoverySpec, task);
  const provider = normalizeLower(recoverySpec.provider || recoverySpec.payload?.provider || task.provider);
  const recoveryMode = resolveRecoveryMode(recoverySpec, task);
  const taskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || task.pollingTaskId || task.asyncTaskId);
  const runtimeTaskId = trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || (recoveryMode === 'local_proxy_poll' ? taskId : ''));
  const clientTaskId = trimString(recoverySpec.clientTaskId || task.clientTaskId);
  const startedAt = getTaskAttemptTime(task) || Date.now();
  const basePatch = {
    ...buildGenerationStartPatch({ startedAt }),
    jobStatus: 'loading',
  };

  if (taskType !== 'image-generation') return basePatch;

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

  if (recoveryMode === 'local_proxy_poll') {
    return {
      ...basePatch,
      asyncRuntimeTaskId: runtimeTaskId,
      ...(clientTaskId ? { asyncClientTaskId: clientTaskId } : {}),
      asyncTaskProvider: provider,
      asyncTaskKind: 'image',
      asyncTaskStatus: 'pending',
      asyncTaskRecovering: true,
      asyncTaskStartedAt: startedAt,
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

function buildTerminalProjection(task = {}, resultPatch = {}) {
  const status = task.status || task.unifiedTask?.status;
  const error = trimString(task.error || task.unifiedTask?.error?.message);
  const recoverySpec = resolveRecoverySpec(task);
  const taskType = resolveTaskType(recoverySpec, task);
  const basePatch = {
    asyncTaskStatus: isGenerationTaskFailureStatus(status)
      ? 'failed'
      : isGenerationTaskCancelledStatus(status)
        ? 'cancelled'
        : isInterruptedStatus(status)
          ? 'interrupted'
          : 'success',
    asyncTaskRecovering: false,
    rhTaskRecovering: false,
    dreaminaTaskRecovering: false,
    asyncRuntimeTaskId: null,
    asyncClientTaskId: null,
    asyncTaskId: null,
    rhTaskId: null,
    dreaminaSubmitId: null,
  };
  const lifecyclePatch = isInterruptedStatus(status)
    ? buildInterruptedPatch()
    : isGenerationTaskFailureStatus(status)
      ? buildGenerationFailurePatch({ error: error || '任务失败' })
      : isGenerationTaskCancelledStatus(status)
        ? buildGenerationCancelledPatch({ startedAt: getTaskAttemptTime(task) })
        : buildGenerationSuccessPatch({ startedAt: getTaskAttemptTime(task) });

  const terminalResultPatch = asObject(resultPatch);
  const failedImageClearPatch = taskType === 'image-generation' && isGenerationTaskFailureStatus(status)
    ? buildFailedImageResultClearPatch()
    : {};
  const failedStatusCardPatch = isGenerationTaskFailureStatus(status)
    ? buildFailedStatusCardPatch(error)
    : {};

  return {
    ...lifecyclePatch,
    ...basePatch,
    ...(taskType === 'image-generation' ? { generationStartTime: null } : {}),
    ...terminalResultPatch,
    ...failedImageClearPatch,
    ...failedStatusCardPatch,
  };
}

export function buildGenerationNodeStateProjection({ phase = '', task = {}, resultPatch = {} } = {}) {
  const normalizedPhase = normalizeLower(phase || task.status || task.unifiedTask?.status);
  if (normalizedPhase === 'running' || ACTIVE_TASK_CENTER_STATUSES.has(normalizedPhase) || normalizedPhase === 'active') {
    return buildRunningProjection(task);
  }
  return buildTerminalProjection(task, resultPatch);
}

export const __test__ = {
  buildRunningProjection,
  buildTerminalProjection,
};