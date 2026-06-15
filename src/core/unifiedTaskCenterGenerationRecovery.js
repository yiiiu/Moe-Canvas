import { mergeGrsaiImageResponseMapping } from '../manifests/image/modelApi/grsaiImageResultMapping.js';
import { buildImageGenerationResultPatch, normalizeImageGenerationResult } from '../components/aigenImage/imageGenerationResultRenderer.js';
import { localPathToUrl, normalizeLocalPath } from '../utils/localMediaPath.js';
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
  isGenerationTaskTerminalStatus,
} from './generationTaskLifecycle.js';
import { resumeTask as resumeGenerationTask } from './generationTaskRuntimeTaskCenterBridge.js';
import {
  resolveAsyncTaskLocalRecoveryTaskId,
  resolveAsyncTaskRecoveryCapability,
} from './asyncTaskRecoveryCapabilities.js';
import {
  buildGenerationNodeStateProjection,
} from './generationTaskNodeStateProjection.js';

const ACTIVE_TASK_CENTER_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending', 'polling']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseJsonObject(value) {
  if (value && typeof value === 'object') return asObject(value);
  if (typeof value !== 'string') return {};
  const text = value.trim();
  if (!text || !/^[{[]/.test(text)) return {};
  try {
    const parsed = JSON.parse(text);
    return asObject(parsed);
  } catch {
    return {};
  }
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

function isLocalProxyRecoverySpec(recoverySpec = {}, task = {}) {
  const capability = resolveAsyncTaskRecoveryCapability({
    ...asObject(task),
    ...asObject(recoverySpec),
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
  return capability.recoveryMode === 'local_proxy_poll' || capability.supportsLocalProxyRecovery === true;
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

function firstTextValue(...values) {
  for (const value of values) {
    const text = trimString(value);
    if (text) return text;
  }
  return '';
}

function firstArrayValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return null;
}

function firstUrlFromResultItems(...values) {
  const fields = ['imageUrl', 'image_url', 'outputUrl', 'output_url', 'url', 'sourceUrl', 'thumbUrl'];
  for (const value of values) {
    const items = Array.isArray(value) ? value : [];
    for (const item of items) {
      if (typeof item === 'string') {
        const url = trimString(item);
        if (url) return url;
        continue;
      }
      const object = asObject(item);
      for (const field of fields) {
        const url = trimString(object[field]);
        if (url) return url;
      }
    }
  }
  return '';
}

function buildVideoResultPatch(result = {}) {
  const value = asObject(result);
  const nested = asObject(value.result);
  const output = asObject(value.output);
  const data = asObject(value.data);
  const videoUrl = firstTextValue(value.videoUrl, value.outputUrl, value.url, nested.videoUrl, nested.outputUrl, nested.url, output.videoUrl, output.outputUrl, output.url, data.videoUrl, data.outputUrl, data.url);
  const videos = firstArrayValue(value.videos, nested.videos, output.videos, data.videos);
  return {
    ...(videoUrl ? { videoUrl } : {}),
    ...(videos ? { videos } : {}),
    ...(firstTextValue(value.thumbUrl, nested.thumbUrl, output.thumbUrl, data.thumbUrl) ? { thumbUrl: firstTextValue(value.thumbUrl, nested.thumbUrl, output.thumbUrl, data.thumbUrl) } : {}),
    ...(firstTextValue(value.localPath, nested.localPath, output.localPath, data.localPath) ? { localPath: firstTextValue(value.localPath, nested.localPath, output.localPath, data.localPath) } : {}),
    ...(firstTextValue(value.displayLocalPath, nested.displayLocalPath, output.displayLocalPath, data.displayLocalPath) ? { displayLocalPath: firstTextValue(value.displayLocalPath, nested.displayLocalPath, output.displayLocalPath, data.displayLocalPath) } : {}),
    ...(firstTextValue(value.posterLocalPath, nested.posterLocalPath, output.posterLocalPath, data.posterLocalPath) ? { posterLocalPath: firstTextValue(value.posterLocalPath, nested.posterLocalPath, output.posterLocalPath, data.posterLocalPath) } : {}),
    ...(firstTextValue(value.sourceUrl, nested.sourceUrl, output.sourceUrl, data.sourceUrl) ? { sourceUrl: firstTextValue(value.sourceUrl, nested.sourceUrl, output.sourceUrl, data.sourceUrl) } : {}),
    ...(value.videoProxyStatus ? { videoProxyStatus: value.videoProxyStatus } : {}),
    ...(value.saveError ? { saveError: value.saveError } : {}),
  };
}

function collectResultEnvelopeObjects(result = {}) {
  const value = asObject(result);
  const response = asObject(value.response);
  const body = parseJsonObject(value.body || response.body);
  const candidates = [
    value,
    asObject(value.result),
    asObject(value.output),
    asObject(value.data),
    response,
    asObject(response.result),
    asObject(response.output),
    asObject(response.data),
    body,
    asObject(body.result),
    asObject(body.output),
    asObject(body.data),
  ];
  return candidates.filter((item, index) => item && Object.keys(item).length && candidates.indexOf(item) === index);
}

function buildImageResultPatch(result = {}, options = {}) {
  const value = asObject(result);
  const candidates = collectResultEnvelopeObjects(value);
  const resultCollections = candidates.flatMap((item) => [
    item.results,
    item.images,
    item.data,
    item.urls,
    item.imageUrls,
    item.image_urls,
  ]);
  const resultsUrl = firstUrlFromResultItems(...resultCollections);
  const imageUrl = firstTextValue(...candidates.flatMap((item) => [
    item.imageUrl,
    item.image_url,
    item.outputUrl,
    item.output_url,
    item.url,
    item.sourceUrl,
    item.resultUrl,
    item.result_url,
  ]), resultsUrl);
  const images = firstArrayValue(...resultCollections);
  const normalized = normalizeImageGenerationResult({
    ...value,
    ...(imageUrl ? { imageUrl } : {}),
    ...(images ? { images } : {}),
  });
  return buildImageGenerationResultPatch(normalized, {
    startedAt: Number(options.startedAt || 0) || 0,
    duration: options.duration ?? null,
  }) || {};
}

function buildAudioResultPatch(result = {}) {
  const value = asObject(result);
  const nested = asObject(value.result);
  const output = asObject(value.output);
  const data = asObject(value.data);
  const audioUrl = firstTextValue(value.audioUrl, value.outputUrl, value.url, nested.audioUrl, nested.outputUrl, nested.url, output.audioUrl, output.outputUrl, output.url, data.audioUrl, data.outputUrl, data.url);
  const audios = firstArrayValue(value.audios, nested.audios, output.audios, data.audios);
  return {
    ...(audioUrl ? { audioUrl, src: audioUrl } : {}),
    ...(audios ? { audios } : {}),
    ...(firstTextValue(value.vocalsAudioUrl, nested.vocalsAudioUrl, output.vocalsAudioUrl, data.vocalsAudioUrl) ? { vocalsAudioUrl: firstTextValue(value.vocalsAudioUrl, nested.vocalsAudioUrl, output.vocalsAudioUrl, data.vocalsAudioUrl) } : {}),
    ...(firstTextValue(value.backgroundAudioUrl, nested.backgroundAudioUrl, output.backgroundAudioUrl, data.backgroundAudioUrl) ? { backgroundAudioUrl: firstTextValue(value.backgroundAudioUrl, nested.backgroundAudioUrl, output.backgroundAudioUrl, data.backgroundAudioUrl) } : {}),
    ...(firstTextValue(value.localPath, nested.localPath, output.localPath, data.localPath) ? { localPath: firstTextValue(value.localPath, nested.localPath, output.localPath, data.localPath) } : {}),
  };
}

function buildTextResultPatch(result = {}) {
  const value = asObject(result);
  const nested = asObject(value.result);
  const output = asObject(value.output);
  const data = asObject(value.data);
  const text = firstTextValue(value.text, value.content, nested.text, nested.content, output.text, output.content, data.text, data.content);
  return text ? { text, content: text } : {};
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
  } else if (taskType === 'text') {
    add('text', patch.text);
    add('content', patch.content);
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

function normalizeRestoredImagePatchForCanvas(patch = {}) {
  const output = { ...asObject(patch) };
  const normalizeDisplayUrl = (value) => {
    const text = trimString(value);
    if (!text) return '';
    if (/^https?:\/\//i.test(text) || text.startsWith('/')) return text;
    const localPath = normalizeLocalPath(text);
    return localPath ? localPathToUrl(localPath) : text;
  };
  const normalizeItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    const displayUrl = normalizeDisplayUrl(next.imageUrl || next.url || next.sourceUrl || next.outputUrl);
    if (displayUrl) {
      next.imageUrl = displayUrl;
      next.url = normalizeDisplayUrl(next.url) || displayUrl;
      next.sourceUrl = normalizeDisplayUrl(next.sourceUrl) || displayUrl;
      next.thumbUrl = normalizeDisplayUrl(next.thumbUrl) || displayUrl;
    }
    return next;
  };
  const imageUrl = normalizeDisplayUrl(output.imageUrl || output.url || output.sourceUrl || output.outputUrl);
  if (imageUrl) {
    output.imageUrl = imageUrl;
    output.sourceUrl = normalizeDisplayUrl(output.sourceUrl) || imageUrl;
    output.thumbUrl = normalizeDisplayUrl(output.thumbUrl) || imageUrl;
  }
  if (Array.isArray(output.images)) output.images = output.images.map(normalizeItem);
  if (!trimString(output.localPath)) {
    const localPath = normalizeLocalPath(patch.imageUrl || patch.sourceUrl || patch.url || patch.outputUrl || output.images?.[0]);
    if (localPath) output.localPath = localPath;
  }
  return output;
}

function buildRestoredTaskTerminalAsyncPatch(taskType = '') {
  if (taskType !== 'image-generation') return {};
  return {
    generationStartTime: null,
    asyncTaskStatus: 'success',
    asyncTaskRecovering: false,
    rhTaskRecovering: false,
    dreaminaTaskRecovering: false,
  };
}

function buildGuardedRestoredResultPatch(taskType = '', result = {}, context = {}, trace = {}, responseMapping = {}) {
  const resultPathHits = collectMappedResultPathHits(result, responseMapping);
  const mappedPatch = resultPathHits.length
    ? buildPatchFromMappedValue(taskType, firstMappedResultValue(result, responseMapping), context)
    : {};
  const rawPatch = buildResultPatch(taskType, result, context);
  const selectedPatch = hasRestoredResultAsset(taskType, mappedPatch) ? mappedPatch : rawPatch;
  const patch = taskType === 'image-generation'
    ? normalizeRestoredImagePatchForCanvas(selectedPatch)
    : selectedPatch;
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
  return {
    ...patch,
    ...buildRestoredTaskTerminalAsyncPatch(taskType),
  };
}

function buildResultPatch(taskType, result, context = {}) {
  if (taskType === 'video') return buildVideoResultPatch(result);
  if (taskType === 'image-generation') return buildImageResultPatch(result, context);
  if (taskType === 'audio') return buildAudioResultPatch(result);
  if (taskType === 'text') return buildTextResultPatch(result);
  return asObject(result);
}

function resolveRecoveryMode(recoverySpec = {}, task = {}) {
  const capability = resolveAsyncTaskRecoveryCapability({
    ...asObject(task),
    ...asObject(recoverySpec),
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
  return trimString(capability.recoveryMode || recoverySpec.recoveryMode || task.recoveryMode);
}

function resolveLocalProxyTaskId(recoverySpec = {}, task = {}) {
  return resolveAsyncTaskLocalRecoveryTaskId({
    ...asObject(task),
    ...asObject(recoverySpec),
    recoverySpec,
    pollingSpec: recoverySpec,
    payload: recoverySpec.payload,
  });
}

function buildLocalProxyTaskUrl(recoverySpec = {}, task = {}) {
  const localRecoveryTaskId = resolveLocalProxyTaskId(recoverySpec, task);
  const runtimeTaskId = trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || localRecoveryTaskId);
  const clientTaskId = trimString(recoverySpec.clientTaskId || task.clientTaskId);
  const params = new URLSearchParams();
  if (runtimeTaskId) params.set('runtimeTaskId', runtimeTaskId);
  if (clientTaskId) params.set('clientTaskId', clientTaskId);
  return `/api/v2/proxy/local-task?${params.toString()}`;
}

const DEFAULT_LOCAL_PROXY_MISSING_GRACE_MS = 60_000;

function normalizeLocalProxyStatus(value = '') {
  const status = normalizeLower(value);
  if (['success', 'succeeded', 'complete', 'completed', 'done', 'finished'].includes(status)) return 'success';
  if (['failed', 'fail', 'failure', 'errored', 'error'].includes(status)) return 'failed';
  if (['missing', 'not_found', 'not-found', 'expired', 'interrupted', 'request_lost'].includes(status)) return 'missing';
  if (['running', 'processing', 'polling', 'pending', 'queued', 'submitted', 'waiting'].includes(status)) return 'running';
  return status || 'missing';
}

async function fetchLocalProxyTaskStatus(recoverySpec = {}, task = {}, context = {}) {
  const fetcher = context.localProxyTaskFetcher || recoverySpec.localProxyTaskFetcher || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('本地代理恢复接口不可用');
  const url = buildLocalProxyTaskUrl(recoverySpec, task);
  const response = await fetcher(url, { method: 'GET', signal: context.signal });
  if (response && typeof response.json === 'function') return response.json();
  return response;
}

function resolveLocalProxyMissingGraceMs(recoverySpec = {}, task = {}, context = {}) {
  const value = Number(context.localProxyMissingGraceMs
    ?? recoverySpec.localProxyMissingGraceMs
    ?? task.localProxyMissingGraceMs
    ?? DEFAULT_LOCAL_PROXY_MISSING_GRACE_MS);
  return Number.isFinite(value) ? Math.max(0, value) : DEFAULT_LOCAL_PROXY_MISSING_GRACE_MS;
}

function resolveLocalProxyNowMs(context = {}) {
  const nowValue = typeof context.now === 'function' ? context.now() : context.now;
  return Number(nowValue || Date.now()) || Date.now();
}

function createLocalProxyPollFunction(recoverySpec = {}, task = {}) {
  let missingFirstSeenAt = 0;
  return async (context = {}) => {
    const payload = await fetchLocalProxyTaskStatus(recoverySpec, task, context);
    const status = normalizeLocalProxyStatus(payload?.status);
    if (status === 'running') {
      return {
        pending: true,
        status: 'running',
        message: payload?.message || '生成仍在本地代理处理中',
        localProxyTask: payload,
      };
    }
    if (status === 'success') return asObject(payload?.result || payload);
    const reason = trimString(payload?.reason || payload?.error || payload?.message || status || 'request_lost');
    if (status === 'missing' && reason !== 'missing_local_task_id') {
      const now = resolveLocalProxyNowMs(context);
      if (!missingFirstSeenAt) missingFirstSeenAt = now;
      const ageMs = Math.max(0, now - missingFirstSeenAt);
      const graceMs = resolveLocalProxyMissingGraceMs(recoverySpec, task, context);
      if (ageMs <= graceMs) {
        return {
          pending: true,
          status: 'running',
          message: payload?.message || '本地代理任务状态暂未登记，继续等待结果',
          localProxyTask: payload,
          localProxyMissing: true,
          localProxyMissingReason: reason,
        };
      }
    }
    const error = new Error(`本地代理任务不可恢复：${reason}`);
    error.localProxyStatus = status;
    error.localProxyReason = reason;
    throw error;
  };
}

function hasRecoverablePollingTaskId(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return Boolean(trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || recoverySpec.queryableTaskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId));
}

function hasRecoverableLocalProxyTaskId(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return Boolean(resolveLocalProxyTaskId(recoverySpec, task));
}

function requiresPollingTaskIdForRecovery(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const mode = resolveRecoveryMode(recoverySpec, task);
  if (mode === 'local_proxy_poll') return false;
  const taskType = resolveTaskType(recoverySpec, task);
  return ['image-generation', 'video', 'audio', 'text', 'provider_async'].includes(taskType) || taskType.includes('generation');
}

function canResumeRestoredTask(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const mode = resolveRecoveryMode(recoverySpec, task);
  if (mode === 'local_proxy_poll') return hasRecoverableLocalProxyTaskId(task);
  return !requiresPollingTaskIdForRecovery(task) || hasRecoverablePollingTaskId(task);
}

function getMatchingRestoredRecoveryIds(task = {}, node = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const restoredIds = [
    recoverySpec.taskId,
    recoverySpec.pollingTaskId,
    recoverySpec.recoveryTaskId,
    recoverySpec.queryableTaskId,
    task.queryableTaskId,
    task.pollingTaskId,
    task.asyncTaskId,
    recoverySpec.runtimeTaskId,
    task.runtimeTaskId,
    recoverySpec.clientTaskId,
    task.clientTaskId,
  ].map(trimString).filter(Boolean);
  if (!restoredIds.length) return [];
  const nodeIds = collectNodeRecoveryTaskIds(node);
  if (!nodeIds.length) return [];
  return restoredIds.filter((id) => nodeIds.includes(id));
}

function pickEarlierFiniteTime(...values) {
  const times = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return times.length ? Math.min(...times) : 0;
}

function preserveSameTaskTimerAnchor(patch = {}, task = {}, node = {}) {
  if (!getMatchingRestoredRecoveryIds(task, node).length) return patch;
  const generationStartTime = pickEarlierFiniteTime(node.generationStartTime, patch.generationStartTime);
  const asyncTaskStartedAt = pickEarlierFiniteTime(node.asyncTaskStartedAt, patch.asyncTaskStartedAt, generationStartTime);
  const rhTaskStartedAt = pickEarlierFiniteTime(node.rhTaskStartedAt, patch.rhTaskStartedAt, generationStartTime);
  const dreaminaTaskStartedAt = pickEarlierFiniteTime(node.dreaminaTaskStartedAt, patch.dreaminaTaskStartedAt, generationStartTime);
  return {
    ...patch,
    ...(generationStartTime ? { generationStartTime } : {}),
    ...(patch.asyncTaskStartedAt !== undefined && asyncTaskStartedAt ? { asyncTaskStartedAt } : {}),
    ...(patch.rhTaskStartedAt !== undefined && rhTaskStartedAt ? { rhTaskStartedAt } : {}),
    ...(patch.dreaminaTaskStartedAt !== undefined && dreaminaTaskStartedAt ? { dreaminaTaskStartedAt } : {}),
  };
}

function buildGenerationLoadingPatch(task = {}, node = {}) {
  const patch = buildGenerationNodeStateProjection({ phase: 'running', task });
  return preserveSameTaskTimerAnchor(patch, task, node);
}

function isRestoredGenerationActiveStatus(status) {
  return ACTIVE_TASK_CENTER_STATUSES.has(normalizeLower(status));
}

function isRestoredGenerationInterruptedStatus(status) {
  return normalizeLower(status) === 'interrupted';
}

function buildGenerationTerminalPatch(task = {}) {
  return buildGenerationNodeStateProjection({ phase: 'terminal', task });
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
      const data = asObject(item.data);
      const nodeId = trimString(item.id || item.nodeId || data.id || data.nodeId);
      if (nodeId) map[nodeId] = { ...data, ...item, data };
      return map;
    }, {});
  }
  return asObject(nodes);
}

function getNodes(store) {
  return normalizeNodesById(getStoreState(store).nodes);
}

function resolveGenerationNodeId(task = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  return trimString(task.nodeId || task.unifiedTask?.nodeId || recoverySpec.targetNodeId || recoverySpec.sourceNodeId);
}

function collectNodeRecoveryTaskIds(node = {}) {
  return [
    node.asyncRuntimeTaskId,
    node.runtimeTaskId,
    node.asyncClientTaskId,
    node.clientTaskId,
    node.asyncTaskId,
    node.pollingTaskId,
    node.rhTaskId,
    node.dreaminaSubmitId,
    node.taskId,
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
  const restoredPollingTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || recoverySpec.queryableTaskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId || recoverySpec.runtimeTaskId || task.runtimeTaskId || recoverySpec.clientTaskId || task.clientTaskId);
  const nodeRecoveryTaskIds = collectNodeRecoveryTaskIds(node);
  if (restoredPollingTaskId && nodeRecoveryTaskIds.length) return nodeRecoveryTaskIds.includes(restoredPollingTaskId);
  const taskAttemptTime = getTaskAttemptTime(task);
  const nodeAttemptTime = getNodeAttemptTime(node);
  if (taskAttemptTime && nodeAttemptTime && nodeAttemptTime > taskAttemptTime) return false;
  return node.isGenerating === true || trimString(node.jobStatus) === 'loading';
}

function isRestoredGenerationTerminalNode(task = {}, node = {}) {
  const recoverySpec = resolveRecoverySpec(task);
  const taskType = resolveTaskType(recoverySpec, task);
  const statuses = [
    node.asyncTaskStatus,
    node.rhTaskStatus,
    node.dreaminaTaskStatus,
    node.jobStatus,
    node.status,
  ].map(normalizeLower).filter(Boolean);
  if (statuses.some((status) => isGenerationTaskTerminalStatus(status) || isRestoredGenerationInterruptedStatus(status))) return true;
  const isActive = node.isGenerating === true || statuses.some((status) => ACTIVE_TASK_CENTER_STATUSES.has(status) || status === 'loading');
  return !isActive && hasRestoredResultAsset(taskType, node);
}

function canRestoreActiveGenerationTaskToNode(task = {}, node = {}) {
  if (isRestoredGenerationTerminalNode(task, node)) return false;
  const recoverySpec = resolveRecoverySpec(task);
  const restoredPollingTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || recoverySpec.queryableTaskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId || recoverySpec.runtimeTaskId || task.runtimeTaskId || recoverySpec.clientTaskId || task.clientTaskId);
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
    applyNodePatch(store, [nodeId], buildGenerationLoadingPatch(task, { id: nodeId, ...node }));
    reconciled.push({ taskId: task.taskId, nodeId });
  }
  return reconciled;
}

function buildRestoredPayload(recoverySpec = {}) {
  const payload = asObject(recoverySpec.payload);
  const provider = trimString(payload.provider || recoverySpec.provider);
  const model = trimString(payload.model || payload.modelId || recoverySpec.modelId || recoverySpec.model);
  const normalizedPayload = isLocalProxyRecoverySpec(recoverySpec)
    ? stripLocalProxyRemotePollingOptions(payload)
    : payload;
  return {
    ...normalizedPayload,
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
  const normalizedTaskMeta = isLocalProxyRecoverySpec(recoverySpec)
    ? stripLocalProxyRemotePollingOptions(taskMeta)
    : taskMeta;
  const normalizedPayload = isLocalProxyRecoverySpec(recoverySpec)
    ? stripLocalProxyRemotePollingOptions(payload)
    : payload;
  const baseOptions = {
    ...normalizedTaskMeta,
    ...(!normalizedTaskMeta.taskPolling && normalizedPayload.taskPolling ? { taskPolling: normalizedPayload.taskPolling } : {}),
    ...(!normalizedTaskMeta.responseMapping && normalizedPayload.responseMapping ? { responseMapping: normalizedPayload.responseMapping } : {}),
    ...(!normalizedTaskMeta.useOpenapiQuery && normalizedPayload.useOpenapiQuery !== undefined ? { useOpenapiQuery: normalizedPayload.useOpenapiQuery } : {}),
  };
  if (provider === 'grsai') {
    const grsaiOptions = { ...baseOptions };
    delete grsaiOptions.taskPolling;
    return {
      ...grsaiOptions,
      responseMapping: mergeGrsaiImageResponseMapping(grsaiOptions.responseMapping),
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
  const recoveryMode = resolveRecoveryMode(recoverySpec, task);
  const localProxyTaskId = resolveLocalProxyTaskId(recoverySpec, task);
  const remoteTaskId = trimString(recoverySpec.taskId || recoverySpec.pollingTaskId || recoverySpec.recoveryTaskId || recoverySpec.queryableTaskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId);
  const taskId = recoveryMode === 'local_proxy_poll' ? localProxyTaskId : remoteTaskId;
  if (!targetNodeId || !taskId) return null;

  const taskType = resolveTaskType(recoverySpec, task);
  const payload = buildRestoredPayload(recoverySpec);
  const poll = recoveryMode === 'local_proxy_poll'
    ? createLocalProxyPollFunction(recoverySpec, task)
    : createPollFunction(recoverySpec, taskType);
  if (typeof poll !== 'function') return null;
  const recoveryPollingTrace = buildRecoveryPollingTrace({ ...recoverySpec, taskId }, taskType);
  const resumeOptions = buildRestoredResumeOptions(recoverySpec);
  const taskMeta = recoveryMode === 'local_proxy_poll'
    ? stripLocalProxyRemotePollingOptions(recoverySpec.taskMeta)
    : asObject(recoverySpec.taskMeta);

  return {
    sourceNodeId: trimString(recoverySpec.sourceNodeId) || targetNodeId,
    targetNodeId,
    trigger: 'restore',
    taskId,
    taskType,
    provider: trimString(recoverySpec.provider),
    recoveryMode,
    runtimeTaskId: trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || (recoveryMode === 'local_proxy_poll' ? localProxyTaskId : '')),
    clientTaskId: trimString(recoverySpec.clientTaskId || task.clientTaskId),
    adapterType: trimString(recoverySpec.adapterType) || 'modelApi',
    modelId: trimString(recoverySpec.modelId),
    executionId: trimString(recoverySpec.executionId) || `restore.${taskType}`,
    payload,
    taskMeta: {
      ...taskMeta,
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
