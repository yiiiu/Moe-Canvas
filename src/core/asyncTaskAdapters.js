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
import { mergeGrsaiImageResponseMapping } from '../manifests/image/modelApi/grsaiImageResultMapping.js';
import { buildImageGenerationResultPatch, normalizeImageGenerationResult } from '../components/aigenImage/imageGenerationResultRenderer.js';
import { buildGenerationFailurePatch, buildGenerationSuccessPatch } from './generationTaskLifecycle.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function resolveProvider(record = {}) {
  return normalizeLower(record.provider || record.pollingSpec?.provider || record.payload?.provider);
}

function buildPayload(record = {}) {
  const pollingSpec = asObject(record.pollingSpec);
  const payload = asObject(record.payload);
  const provider = trimString(payload.provider || pollingSpec.provider || record.provider);
  const model = trimString(payload.model || payload.modelId || pollingSpec.model || pollingSpec.modelId || record.modelId);
  return {
    ...payload,
    ...(provider ? { provider } : {}),
    ...(model ? { model, modelId: trimString(payload.modelId || pollingSpec.modelId || record.modelId || model) } : {}),
    ...(trimString(payload.adapterType || pollingSpec.adapterType) ? { adapterType: trimString(payload.adapterType || pollingSpec.adapterType) } : {}),
    ...(trimString(payload.executionId || pollingSpec.executionId) ? { executionId: trimString(payload.executionId || pollingSpec.executionId) } : {}),
  };
}

function buildResumeOptions(record = {}) {
  const provider = resolveProvider(record);
  const pollingSpec = asObject(record.pollingSpec);
  const payload = asObject(record.payload);
  const options = {
    ...pollingSpec,
    ...(!pollingSpec.taskPolling && payload.taskPolling ? { taskPolling: payload.taskPolling } : {}),
    ...(!pollingSpec.responseMapping && payload.responseMapping ? { responseMapping: payload.responseMapping } : {}),
    ...(!pollingSpec.useOpenapiQuery && payload.useOpenapiQuery !== undefined ? { useOpenapiQuery: payload.useOpenapiQuery } : {}),
  };
  if (provider === 'grsai') {
    return {
      ...options,
      responseMapping: mergeGrsaiImageResponseMapping(options.responseMapping),
    };
  }
  return options;
}

function normalizeKind(record = {}) {
  const value = normalizeLower(record.kind || record.taskType || record.pollingSpec?.taskType);
  if (value.includes('image')) return 'image';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  if (value.includes('media')) return 'media';
  if (value.includes('text') || value.includes('chat') || value.includes('llm')) return 'text';
  return value || 'provider_async';
}

function isTextTaskRecord(record = {}) {
  const kind = normalizeKind(record);
  const text = [
    kind,
    record.taskType,
    record.kind,
    record.pollingSpec?.taskType,
    record.pollingSpec?.kind,
    record.payload?.taskType,
    record.payload?.kind,
  ].map(normalizeLower).join(' ');
  return kind === 'text' || text.includes('text') || text.includes('chat') || text.includes('llm');
}

function buildImagePatch(result = {}, record = {}) {
  const normalized = normalizeImageGenerationResult(result);
  return buildImageGenerationResultPatch(normalized, {
    startedAt: Number(record.createdAt || 0) || 0,
    duration: null,
  }) || {};
}

function buildVideoPatch(result = {}) {
  const value = asObject(result);
  return {
    ...(value.videoUrl ? { videoUrl: value.videoUrl } : {}),
    ...(Array.isArray(value.videos) ? { videos: value.videos } : {}),
    ...(value.thumbUrl ? { thumbUrl: value.thumbUrl } : {}),
    ...(value.localPath ? { localPath: value.localPath } : {}),
    ...(value.displayLocalPath ? { displayLocalPath: value.displayLocalPath } : {}),
    ...(value.posterLocalPath ? { posterLocalPath: value.posterLocalPath } : {}),
    ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
  };
}

function buildAudioPatch(result = {}) {
  const value = asObject(result);
  return {
    ...(value.audioUrl ? { audioUrl: value.audioUrl, src: value.audioUrl } : {}),
    ...(Array.isArray(value.audios) ? { audios: value.audios } : {}),
    ...(value.vocalsAudioUrl ? { vocalsAudioUrl: value.vocalsAudioUrl } : {}),
    ...(value.backgroundAudioUrl ? { backgroundAudioUrl: value.backgroundAudioUrl } : {}),
    ...(value.localPath ? { localPath: value.localPath } : {}),
  };
}

export function buildAsyncTaskLoadingPatch(record = {}) {
  const kind = normalizeKind(record);
  const provider = resolveProvider(record);
  const startedAt = Number(record.createdAt || Date.now()) || Date.now();
  const basePatch = {
    asyncRuntimeTaskId: record.runtimeTaskId,
    remoteTaskId: record.remoteTaskId,
    taskProvider: provider,
    taskModelId: record.modelId,
    taskResumable: record.canResume !== false,
    isGenerating: true,
    jobStatus: 'loading',
    jobError: null,
    generationStartTime: startedAt,
    asyncTaskId: record.remoteTaskId,
    asyncTaskProvider: provider,
    asyncTaskKind: kind,
    asyncTaskStatus: 'running',
    asyncTaskRecovering: true,
    asyncTaskStartedAt: startedAt,
  };
  if (kind === 'image') {
    return {
      ...basePatch,
      asyncTaskKind: 'image',
    };
  }
  if (isTextTaskRecord(record)) {
    return {
      ...basePatch,
      jobStatus: 'running',
      taskType: 'text',
      taskCancellable: record.canCancel === true,
      asyncTaskKind: 'text',
      textTaskStatus: 'running',
      textTaskRecovering: true,
    };
  }
  return basePatch;
}

export function buildAsyncTaskResultPatch(record = {}, result = {}) {
  const kind = normalizeKind(record);
  if (kind === 'image') return buildImagePatch(result, record);
  if (kind === 'video') return { ...buildVideoPatch(result), ...buildGenerationSuccessPatch({ startedAt: record.createdAt }) };
  if (kind === 'audio') return { ...buildAudioPatch(result), ...buildGenerationSuccessPatch({ startedAt: record.createdAt }) };
  return { ...asObject(result), ...buildGenerationSuccessPatch({ startedAt: record.createdAt }) };
}

export function buildAsyncTaskFailurePatch(record = {}, error = '') {
  return buildGenerationFailurePatch({ error, startedAt: record.createdAt });
}

export function createAsyncTaskPoller(record = {}) {
  const provider = resolveProvider(record);
  const kind = normalizeKind(record);
  const payload = buildPayload(record);
  const options = buildResumeOptions(record);
  const taskId = trimString(record.remoteTaskId);
  if (!taskId) return null;

  if (kind === 'image') {
    if (provider === 'runninghub' || provider === 'runninghubwf') {
      return ({ signal } = {}) => resumeRunningHubImageTask(taskId, payload, { ...options, signal });
    }
    if (provider === 'dreamina') {
      return ({ signal } = {}) => resumeDreaminaImageTask(taskId, payload, { ...options, signal });
    }
    return ({ signal } = {}) => resumeAsyncImageTask(taskId, payload, { ...options, signal });
  }

  if (kind === 'video') {
    if (provider === 'runninghub' || provider === 'runninghubwf') {
      return ({ signal } = {}) => resumeRunningHubVideoTask(taskId, payload, { ...options, signal });
    }
    if (provider === 'dreamina') {
      return ({ signal } = {}) => resumeDreaminaVideoTask(taskId, { ...payload, signal });
    }
    return ({ signal } = {}) => resumeAsyncVideoTask(taskId, payload, { ...options, signal });
  }

  if (kind === 'audio') {
    return ({ signal } = {}) => resumeRunningHubAudioTask(taskId, payload, { ...options, signal });
  }

  return null;
}

export const __test__ = {
  buildPayload,
  buildResumeOptions,
  normalizeKind,
  resolveProvider,
};