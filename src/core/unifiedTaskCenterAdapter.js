import { createUnifiedGenerationTask } from './unifiedGenerationTaskModel.js';

const TASK_CENTER_STATUS_BY_UNIFIED_STATUS = Object.freeze({
  queued: 'waiting',
  running: 'processing',
  polling: 'processing',
  success: 'complete',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
});

const DEFAULT_MESSAGE_BY_STATUS = Object.freeze({
  waiting: '等待中',
  processing: '生成中',
  complete: '已完成',
  failed: '失败',
  interrupted: '已中断',
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampProgress(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function resolveTaskCenterKind(task) {
  const kind = trimString(task.kind);
  if (kind === 'video') return 'videoGeneration';
  if (kind === 'image') return 'imageGeneration';
  if (kind === 'audio') return 'audioGeneration';
  if (kind === 'text') return 'textGeneration';
  if (kind === 'media') return 'mediaTask';
  return 'providerAsyncGeneration';
}

function resolveResultFromOutputRefs(outputRefs = []) {
  const result = {};
  for (const ref of Array.isArray(outputRefs) ? outputRefs : []) {
    const item = asObject(ref);
    const value = trimString(item.value);
    if (!value) continue;
    if (item.kind === 'localPath' && !result.localPath) result.localPath = value;
    if (item.kind === 'image' && !result.imageUrl) result.imageUrl = value;
    if (item.kind === 'video' && !result.videoUrl) result.videoUrl = value;
    if (item.kind === 'audio' && !result.audioUrl) result.audioUrl = value;
    if (item.kind === 'thumb' && !result.thumbUrl) result.thumbUrl = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function toTaskCenterTask(input = {}) {
  const task = createUnifiedGenerationTask(input);
  const status = TASK_CENTER_STATUS_BY_UNIFIED_STATUS[task.status] || 'waiting';
  const errorMessage = trimString(task.error?.message || task.error);
  const providerModel = [task.provider, task.model].filter(Boolean).join(' · ');
  const message = trimString(input.message)
    || trimString(task.promptSummary)
    || providerModel
    || DEFAULT_MESSAGE_BY_STATUS[status]
    || '';

  return {
    taskId: task.id,
    nodeId: task.nodeId,
    kind: resolveTaskCenterKind(task),
    status,
    progress: clampProgress(task.progress),
    canCancel: task.canCancel,
    message,
    error: errorMessage,
    result: resolveResultFromOutputRefs(task.outputRefs),
    createdAt: task.createdAt,
    startedAt: task.status === 'queued' ? 0 : task.createdAt,
    finishedAt: ['success', 'failed', 'cancelled', 'interrupted'].includes(task.status) ? task.updatedAt : 0,
    unifiedTask: task,
  };
}

export function upsertUnifiedTaskToTaskCenter(input = {}, manager = globalThis.window?.__aiCanvasTaskCenterManager) {
  if (!manager || typeof manager.upsertTask !== 'function') return null;
  const taskCenterTask = {
    ...toTaskCenterTask(input),
    ...asObject(input.taskCenterExtras),
  };
  manager.upsertTask(taskCenterTask);
  return taskCenterTask;
}