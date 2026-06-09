const TASK_KIND_VALUES = new Set(['image', 'video', 'audio', 'media', 'provider_async']);
const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled', 'interrupted']);

const STATUS_ALIASES = Object.freeze({
  queued: new Set(['queued', 'queueing', 'waiting', 'submitted', 'created']),
  running: new Set(['running', 'generating', 'processing', 'in_progress', 'in-progress', 'started', 'active']),
  polling: new Set(['pending', 'polling', 'recovering', 'checking']),
  success: new Set(['success', 'succeeded', 'complete', 'completed', 'done', 'finished', 'ok']),
  failed: new Set(['failed', 'failure', 'error', 'errored', 'rejected']),
  cancelled: new Set(['cancelled', 'canceled', 'cancel', 'aborted']),
  interrupted: new Set(['interrupted', 'interrupt', 'disconnected']),
});

const KIND_ALIASES = Object.freeze({
  image: new Set(['image', 'ai-image', 'source-image', 'image-hd', 'image-edit', 'image-generation']),
  video: new Set(['video', 'ai-video', 'source-video', 'video-generation']),
  audio: new Set(['audio', 'ai-audio', 'source-audio', 'voice-clone', 'music']),
  media: new Set(['media', 'local', 'local-runtime', 'ffmpeg', 'transcode', 'extract-frame']),
  provider_async: new Set(['provider_async', 'provider-async', 'async', 'model-api-async']),
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickFirstString(...values) {
  for (const value of values) {
    const text = trimString(value);
    if (text) return text;
  }
  return '';
}

function normalizeBool(value) {
  return value === true;
}

function normalizeTimestamp(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizeUnifiedTaskKind(value, fallback = 'provider_async') {
  const text = trimString(value).toLowerCase();
  for (const [kind, aliases] of Object.entries(KIND_ALIASES)) {
    if (aliases.has(text)) return kind;
  }
  return TASK_KIND_VALUES.has(fallback) ? fallback : 'provider_async';
}

export function inferUnifiedTaskKind({ node = {}, spec = {} } = {}) {
  const nodeData = asObject(node);
  const taskSpec = asObject(spec);
  const direct = pickFirstString(taskSpec.kind, taskSpec.taskKind, taskSpec.taskType, nodeData.taskKind, nodeData.asyncTaskKind);
  if (direct) return normalizeUnifiedTaskKind(direct);

  const nodeType = trimString(nodeData.type).toLowerCase();
  if (nodeType.includes('video')) return 'video';
  if (nodeType.includes('audio')) return 'audio';
  if (nodeType.includes('image')) return 'image';

  const adapterType = trimString(taskSpec.adapterType || nodeData.taskAdapterType).toLowerCase();
  if (adapterType.includes('local')) return 'media';
  if (adapterType.includes('model') || adapterType.includes('workflow')) return 'provider_async';

  return 'provider_async';
}

export function normalizeUnifiedTaskStatus(value, { isGenerating = false, recovering = false } = {}) {
  const text = trimString(value).toLowerCase();
  for (const [status, aliases] of Object.entries(STATUS_ALIASES)) {
    if (aliases.has(text)) return status;
  }
  if (recovering) return 'polling';
  if (isGenerating) return 'running';
  return 'queued';
}

export function resolveUnifiedTaskStatus({ node = {}, spec = {}, status } = {}) {
  const nodeData = asObject(node);
  const taskSpec = asObject(spec);
  const rawStatus = pickFirstString(
    status,
    taskSpec.status,
    taskSpec.taskStatus,
    nodeData.asyncTaskStatus,
    nodeData.rhTaskStatus,
    nodeData.dreaminaTaskStatus,
    nodeData.jobStatus,
    nodeData.status,
  );
  const recovering = Boolean(nodeData.asyncTaskRecovering || nodeData.rhTaskRecovering || nodeData.dreaminaTaskRecovering);
  return normalizeUnifiedTaskStatus(rawStatus, { isGenerating: Boolean(nodeData.isGenerating), recovering });
}

export function isUnifiedTaskTerminal(status) {
  return TERMINAL_STATUSES.has(normalizeUnifiedTaskStatus(status));
}

export function resolveUnifiedTaskId({ node = {}, spec = {} } = {}) {
  const nodeData = asObject(node);
  const taskSpec = asObject(spec);
  return pickFirstString(
    taskSpec.id,
    taskSpec.taskId,
    taskSpec.asyncTaskId,
    taskSpec.remoteTaskId,
    nodeData.unifiedTaskId,
    nodeData.asyncTaskId,
    nodeData.rhTaskId,
    nodeData.dreaminaSubmitId,
    nodeData.taskId,
    nodeData.id && `${nodeData.id}:local`,
  );
}

export function normalizeUnifiedTaskError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  const object = asObject(error);
  const message = pickFirstString(
    object.userMessage,
    typeof object.getUserMessage === 'function' ? object.getUserMessage() : '',
    object.message,
    object.error,
    object.msg,
  );
  return {
    message: message || '任务失败',
    code: pickFirstString(object.code, object.status, object.name),
    detail: object.detail ?? object.details ?? object.raw ?? null,
  };
}

function pushOutputRef(refs, kind, value, extra = {}) {
  const text = trimString(value);
  if (!text) return;
  if (refs.some((item) => item.value === text && item.kind === kind)) return;
  refs.push({ kind, value: text, ...extra });
}

export function collectUnifiedTaskOutputRefs(node = {}) {
  const nodeData = asObject(node);
  const refs = [];

  pushOutputRef(refs, 'image', nodeData.imageUrl || nodeData.src || nodeData.url || nodeData.resultUrl);
  pushOutputRef(refs, 'video', nodeData.videoUrl || nodeData.videoSrc);
  pushOutputRef(refs, 'audio', nodeData.audioUrl || nodeData.audioSrc);
  pushOutputRef(refs, 'localPath', nodeData.localPath || nodeData.outputLocalPath || nodeData.displayLocalPath || nodeData.waveformLocalPath || nodeData.posterLocalPath);
  pushOutputRef(refs, 'thumb', nodeData.thumbUrl || nodeData.thumbLocalPath || nodeData.posterLocalPath || nodeData.posterUrl);

  if (Array.isArray(nodeData.images)) {
    nodeData.images.forEach((image, index) => {
      const item = asObject(image);
      pushOutputRef(refs, 'image', item.imageUrl || item.url || item.src || item.localPath, { index });
    });
  }

  return refs;
}

export function createUnifiedGenerationTask(input = {}) {
  const source = asObject(input);
  const node = asObject(source.node);
  const spec = asObject(source.spec);
  const now = normalizeTimestamp(source.now, Date.now());
  const status = resolveUnifiedTaskStatus({ node, spec, status: source.status });
  const taskId = resolveUnifiedTaskId({ node, spec });
  const kind = inferUnifiedTaskKind({ node, spec });
  const nodeId = pickFirstString(source.nodeId, spec.targetNodeId, spec.sourceNodeId, node.id);
  const provider = pickFirstString(source.provider, spec.provider, node.provider, node.asyncTaskProvider);
  const model = pickFirstString(source.model, spec.modelId, spec.model, node.model);
  const error = normalizeUnifiedTaskError(source.error || node.jobError || node.error || spec.error);

  return {
    id: taskId || `${nodeId || kind}:${now}`,
    kind,
    status,
    nodeId,
    canvasId: pickFirstString(source.canvasId, spec.canvasId, node.canvasId),
    provider,
    model,
    title: pickFirstString(source.title, spec.title, node.name, node.title, `${kind} 任务`),
    promptSummary: pickFirstString(source.promptSummary, spec.promptSummary, spec.payload?.prompt, node.prompt),
    progress: Number.isFinite(Number(source.progress ?? node.progress)) ? Number(source.progress ?? node.progress) : null,
    canCancel: kind === 'media' && normalizeBool(source.canCancel ?? spec.cancellable ?? node.taskCancellable),
    canRetry: status === 'failed' || normalizeBool(source.canRetry),
    canResume: normalizeBool(source.canResume ?? spec.resumable ?? node.taskResumable),
    inputRefs: Array.isArray(source.inputRefs) ? [...source.inputRefs] : [],
    outputRefs: collectUnifiedTaskOutputRefs(node),
    error,
    createdAt: normalizeTimestamp(source.createdAt, normalizeTimestamp(node.generationStartTime, now)),
    updatedAt: normalizeTimestamp(source.updatedAt, now),
  };
}

export function createUnifiedGenerationTaskList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => createUnifiedGenerationTask(item))
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
}