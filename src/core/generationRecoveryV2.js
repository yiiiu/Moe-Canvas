import { saveOutputFromUrlToServer } from '../../api/projectsV2Api.js';
import { buildImageGenerationResultPatch, normalizeImageGenerationResult } from '../components/aigenImage/imageGenerationResultRenderer.js';
import { upsertAsyncTaskRecord } from './asyncTaskStore.js';
import { writeAsyncTaskNodeBackfill } from './asyncTaskNodeWriteback.js';

const ACTIVE_STATUSES = new Set(['waiting', 'submitted', 'processing', 'running', 'queued', 'pending', 'polling']);
const PENDING_STATUSES = new Set(['', 'submitted', 'pending', 'running', 'polling', 'processing', 'queued', 'waiting']);
const TERMINAL_STATUSES = new Set(['success', 'complete', 'completed', 'done', 'finished', 'succeeded', 'failed', 'fail', 'failure', 'error', 'errored', 'cancelled', 'canceled', 'interrupted']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLower(value) {
  return trimString(value).toLowerCase();
}

function nowFrom(options = {}) {
  return typeof options.now === 'function' ? Number(options.now()) || Date.now() : Date.now();
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function resolveRecoverySpec(task = {}) {
  return asObject(task.recoverySpec || task.unifiedTask?.recoverySpec || task.pollingSpec);
}

function resolveTaskKind(task = {}, recoverySpec = {}) {
  const kind = normalizeLower(recoverySpec.taskType || recoverySpec.kind || task.unifiedTask?.kind || task.kind);
  if (kind.includes('image')) return 'image-generation';
  if (kind.includes('video')) return 'video';
  if (kind.includes('audio')) return 'audio';
  return kind || 'provider_async';
}

function resolveTargetNodeId(task = {}, recoverySpec = {}) {
  return trimString(
    recoverySpec.targetNodeId
      || task.targetNodeId
      || task.pollingSpec?.targetNodeId
      || task.unifiedTask?.targetNodeId
      || task.unifiedTask?.recoverySpec?.targetNodeId
      || task.nodeId
      || task.unifiedTask?.nodeId
      || recoverySpec.sourceNodeId,
  );
}

function getStoreNodes(store) {
  const state = typeof store?.getState === 'function' ? store.getState() : {};
  const nodes = state?.nodes;
  if (Array.isArray(nodes)) return Object.fromEntries(nodes.filter(Boolean).map((node) => [node.id, node]));
  return asObject(nodes);
}

function resolveNodeStartedAt(store, nodeId = '') {
  const nodeSnapshot = asObject(getStoreNodes(store)[nodeId]);
  return firstFiniteNumber(
    nodeSnapshot.generationStartTime,
    nodeSnapshot.asyncTaskStartedAt,
    nodeSnapshot.rhTaskStartedAt,
    nodeSnapshot.dreaminaTaskStartedAt,
    nodeSnapshot.startedAt,
  );
}

function resolveStartedAt(task = {}, recoverySpec = {}, options = {}) {
  return firstFiniteNumber(
    recoverySpec.startedAt,
    task.startedAt,
    task.createdAt,
    task.updatedAt,
    task.unifiedTask?.createdAt,
    task.unifiedTask?.updatedAt,
    resolveNodeStartedAt(options.store, resolveTargetNodeId(task, recoverySpec)),
    nowFrom(options),
  ) || nowFrom(options);
}

function refreshTicketStartedAtFromNode(ticket = {}, store, graceMs = 0) {
  const nodeStartedAt = resolveNodeStartedAt(store, ticket.targetNodeId);
  if (!nodeStartedAt || nodeStartedAt === ticket.startedAt) return ticket;
  const startedAt = Math.min(nodeStartedAt, firstFiniteNumber(ticket.startedAt) || nodeStartedAt);
  ticket.startedAt = startedAt;
  ticket.deadlineAt = startedAt + graceMs;
  ticket.recoverySpec = {
    ...ticket.recoverySpec,
    startedAt,
  };
  return ticket;
}

function normalizeStatus(value = '') {
  const status = normalizeLower(value);
  if (status === 'complete' || status === 'completed' || status === 'done' || status === 'finished' || status === 'succeeded') return 'success';
  if (status === 'error' || status === 'errored' || status === 'fail' || status === 'failure') return 'failed';
  if (status === 'canceled') return 'cancelled';
  return status;
}

function resolveRemotePollUrl(recoverySpec = {}) {
  const taskPolling = asObject(recoverySpec.taskPolling || recoverySpec.payload?.taskPolling);
  const taskId = trimString(recoverySpec.queryableTaskId || recoverySpec.pollingTaskId || recoverySpec.taskId);
  const direct = trimString(recoverySpec.pollUrl || recoverySpec.apiUrl || taskPolling.pollUrl || taskPolling.url || taskPolling.urlTemplate);
  if (!direct) return '';
  return taskId ? direct.replaceAll('{taskId}', encodeURIComponent(taskId)) : direct;
}

export function buildGenerationRecoveryV2Tickets(tasks = [], options = {}) {
  const graceMs = Math.max(0, Number(options.graceMs ?? 60000) || 0);
  return (Array.isArray(tasks) ? tasks : []).map((task) => {
    const recoverySpec = resolveRecoverySpec(task);
    const status = normalizeLower(task.status || task.unifiedTask?.status);
    const mode = normalizeLower(recoverySpec.recoveryMode || task.recoveryMode);
    const targetNodeId = resolveTargetNodeId(task, recoverySpec);
    const provider = normalizeLower(recoverySpec.provider || recoverySpec.payload?.provider || task.provider);
    const runtimeTaskId = trimString(recoverySpec.runtimeTaskId || task.runtimeTaskId || recoverySpec.payload?.runtimeTaskId);
    const clientTaskId = trimString(recoverySpec.clientTaskId || task.clientTaskId || recoverySpec.payload?.clientTaskId);
    const pollingTaskId = trimString(recoverySpec.queryableTaskId || recoverySpec.pollingTaskId || recoverySpec.taskId || task.queryableTaskId || task.pollingTaskId || task.asyncTaskId);
    const pollUrl = resolveRemotePollUrl(recoverySpec);
    const startedAt = resolveStartedAt(task, recoverySpec, options);
    if (!ACTIVE_STATUSES.has(status) || !targetNodeId) return null;
    if (mode === 'local_proxy_poll') {
      if (!(runtimeTaskId || clientTaskId)) return null;
      return {
        id: trimString(task.taskId || task.unifiedTask?.id) || `${targetNodeId}:local:${runtimeTaskId || clientTaskId}`,
        mode: 'local_proxy_poll',
        kind: resolveTaskKind(task, recoverySpec),
        targetNodeId,
        provider,
        startedAt,
        deadlineAt: startedAt + graceMs,
        local: { runtimeTaskId, clientTaskId },
        task,
        recoverySpec,
      };
    }
    if (mode === 'remote_poll') {
      if (!pollingTaskId || !pollUrl) return null;
      return {
        id: trimString(task.taskId || task.unifiedTask?.id) || `${targetNodeId}:remote:${pollingTaskId}`,
        mode: 'remote_poll',
        kind: resolveTaskKind(task, recoverySpec),
        targetNodeId,
        provider,
        startedAt,
        deadlineAt: startedAt + graceMs,
        remote: { pollingTaskId, queryableTaskId: pollingTaskId, pollUrl },
        task,
        recoverySpec,
      };
    }
    return null;
  }).filter(Boolean);
}

function createLocalProxyUrl(ticket = {}) {
  const params = new URLSearchParams();
  if (ticket.local?.runtimeTaskId) params.set('runtimeTaskId', ticket.local.runtimeTaskId);
  if (ticket.local?.clientTaskId) params.set('clientTaskId', ticket.local.clientTaskId);
  return `/api/v2/proxy/local-task?${params.toString()}`;
}

function createRemotePollUrl(ticket = {}) {
  const params = new URLSearchParams();
  params.set('apiUrl', ticket.remote?.pollUrl || '');
  return `/api/v2/proxy/task?${params.toString()}`;
}

function createPollUrl(ticket = {}) {
  return ticket.mode === 'remote_poll' ? createRemotePollUrl(ticket) : createLocalProxyUrl(ticket);
}

function readJsonResponse(response) {
  if (!response || typeof response.json !== 'function') return Promise.resolve({});
  return response.json().then(asObject);
}

function parseJsonObject(value) {
  if (value && typeof value === 'object') return asObject(value);
  if (typeof value !== 'string') return {};
  const text = value.trim();
  if (!text || !/^[{[]/.test(text)) return {};
  try {
    return asObject(JSON.parse(text));
  } catch {
    return {};
  }
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

function unwrapLocalProxyResult(payload = {}) {
  const value = asObject(payload);
  return asObject(value.result || value.response || value.body || value.data || value);
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

function firstUrlFromResultItems(...collections) {
  const fields = ['imageUrl', 'image_url', 'outputUrl', 'output_url', 'url', 'sourceUrl', 'thumbUrl', 'resultUrl', 'result_url'];
  for (const collection of collections) {
    const items = Array.isArray(collection) ? collection : [];
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

function buildTextResultPatch(result = {}) {
  const value = asObject(result);
  const candidates = collectResultEnvelopeObjects(value);
  const choice = candidates.map((item) => Array.isArray(item.choices) ? asObject(item.choices[0]) : {}).find((item) => Object.keys(item).length) || {};
  const message = asObject(choice.message);
  const outputText = firstTextValue(...candidates.flatMap((item) => [
    item.outputText,
    item.text,
    item.content,
    item.message,
    item.output_text,
  ]), message.content, choice.delta?.content);
  if (!outputText) return value;
  return {
    ...value,
    outputText,
    ...(firstTextValue(...candidates.map((item) => item.id)) ? { responseId: firstTextValue(...candidates.map((item) => item.id)) } : {}),
    ...(firstTextValue(...candidates.map((item) => item.model)) ? { model: firstTextValue(...candidates.map((item) => item.model)) } : {}),
    ...(firstTextValue(choice.finish_reason) ? { finishReason: firstTextValue(choice.finish_reason) } : {}),
  };
}

function buildResultPatch(ticket = {}, payload = {}) {
  if (ticket.kind === 'image-generation') return buildImageResultPatch(unwrapLocalProxyResult(payload), { startedAt: ticket.startedAt });
  if (ticket.kind === 'text-generation' || ticket.kind === 'text') return buildTextResultPatch(unwrapLocalProxyResult(payload));
  return unwrapLocalProxyResult(payload);
}

function hasImageResultPatch(patch = {}) {
  const value = asObject(patch);
  return Boolean(trimString(value.imageUrl || value.sourceUrl || value.thumbUrl || value.localPath));
}

function isRemoteImageUrl(value = '') {
  return /^https?:\/\//i.test(trimString(value));
}

function pickImagePatchRemoteUrl(patch = {}) {
  const value = asObject(patch);
  const direct = firstTextValue(value.imageUrl, value.sourceUrl, value.url, value.resultUrl);
  if (isRemoteImageUrl(direct)) return direct;
  const images = Array.isArray(value.images) ? value.images : [];
  for (const image of images) {
    const item = asObject(image);
    const url = firstTextValue(item.imageUrl, item.sourceUrl, item.url, item.resultUrl);
    if (isRemoteImageUrl(url)) return url;
  }
  return '';
}

function normalizeSavedOutputResult(value = {}) {
  const output = asObject(value);
  const localPath = firstTextValue(output.localPath, output.path, output.displayLocalPath);
  const displayUrl = firstTextValue(output.displayUrl, output.url, localPath ? `/${localPath}` : '');
  return {
    localPath,
    displayLocalPath: firstTextValue(output.displayLocalPath, localPath),
    originalLocalPath: firstTextValue(output.originalLocalPath, localPath),
    thumbLocalPath: firstTextValue(output.thumbLocalPath),
    imageUrl: displayUrl,
    sourceUrl: displayUrl,
    thumbUrl: firstTextValue(output.thumbUrl, displayUrl),
  };
}

function applySavedOutputToImagePatch(patch = {}, saved = {}) {
  const savedFields = normalizeSavedOutputResult(saved);
  if (!savedFields.localPath || !savedFields.imageUrl) return patch;
  const images = Array.isArray(patch.images) ? patch.images.map((image, index) => {
    if (index !== (Number.isFinite(Number(patch.mainImageIndex)) ? Number(patch.mainImageIndex) : 0)) return image;
    return {
      ...asObject(image),
      ...savedFields,
    };
  }) : [];
  return {
    ...patch,
    ...savedFields,
    ...(images.length ? { images } : {}),
  };
}

async function buildTerminalResultPatch(ticket = {}, payload = {}, options = {}) {
  const resultPatch = buildResultPatch(ticket, payload);
  if (ticket.kind !== 'image-generation' || !hasImageResultPatch(resultPatch)) return resultPatch;
  const remoteUrl = pickImagePatchRemoteUrl(resultPatch);
  if (!remoteUrl) return resultPatch;
  const saveOutputFromUrl = typeof options.saveOutputFromUrl === 'function'
    ? options.saveOutputFromUrl
    : saveOutputFromUrlToServer;
  try {
    const saved = await saveOutputFromUrl({
      url: remoteUrl,
      ext: 'png',
      dedupeKey: `${ticket.id}:${remoteUrl}`,
    });
    return applySavedOutputToImagePatch(resultPatch, saved);
  } catch {
    return resultPatch;
  }
}

function resolvePollStatus(ticket = {}, payload = {}) {
  const outerStatus = normalizeStatus(payload.status);
  const inner = unwrapLocalProxyResult(payload);
  const innerStatus = normalizeStatus(inner.status || inner.result?.status || inner.data?.status || inner.output?.status);
  if (ticket.kind === 'image-generation' && hasImageResultPatch(buildImageResultPatch(inner, { startedAt: ticket.startedAt }))) return 'success';
  return innerStatus && TERMINAL_STATUSES.has(innerStatus) ? innerStatus : outerStatus;
}

function isTransientLocalProxyMissing(ticket = {}, payload = {}) {
  if (ticket.mode !== 'local_proxy_poll') return false;
  const status = normalizeStatus(payload.status || unwrapLocalProxyResult(payload).status);
  if (status !== 'missing' && status !== 'not_found') return false;
  const reason = normalizeLower(payload.reason || payload.error || payload.message || unwrapLocalProxyResult(payload).reason);
  return !reason || reason.includes('request_lost') || reason.includes('missing') || reason.includes('not_found');
}

function applyNodeBackfill(store, phase, task = {}, resultPatch = {}) {
  return writeAsyncTaskNodeBackfill({
    store,
    phase,
    task,
    resultPatch,
  }).ok;
}

function upsertManagerTask(manager, task) {
  if (!manager || typeof manager.upsertTask !== 'function') return;
  manager.upsertTask({
    ...task,
    projectionSource: 'asyncTaskRuntime',
    ownsRecoveryFact: false,
  });
}

function buildAsyncTaskResultSpec(payload = {}, resultPatch = {}) {
  const resultSpec = { ...asObject(payload.result || payload), ...asObject(resultPatch) };
  delete resultSpec.displayLocalPath;
  delete resultSpec.sourceUrl;
  if (Array.isArray(resultSpec.images)) {
    resultSpec.images = resultSpec.images.map((image) => {
      const item = { ...asObject(image) };
      delete item.displayLocalPath;
      delete item.sourceUrl;
      return item;
    });
  }
  return resultSpec;
}

function syncAsyncTaskCache(ticket = {}, task = {}, resultPatch = {}, payload = {}, options = {}) {
  const now = nowFrom(options);
  const status = normalizeStatus(task.status);
  upsertAsyncTaskRecord({
    runtimeTaskId: ticket.local?.runtimeTaskId || ticket.remote?.pollingTaskId || ticket.id,
    clientTaskId: ticket.local?.clientTaskId || '',
    pollingTaskId: status === 'success' ? '' : ticket.remote?.pollingTaskId || ticket.recoverySpec?.pollingTaskId || ticket.recoverySpec?.taskId || '',
    queryableTaskId: status === 'success' ? '' : ticket.remote?.queryableTaskId || ticket.recoverySpec?.queryableTaskId || ticket.recoverySpec?.pollingTaskId || ticket.recoverySpec?.taskId || '',
    remoteTaskId: payload.remoteTaskId || payload.result?.id || ticket.recoverySpec?.remoteTaskId || '',
    remoteResultId: payload.remoteResultId || payload.resultId || payload.result?.id || '',
    recoveryMode: ticket.mode,
    recoveryCapability: ticket.recoverySpec?.recoveryCapability,
    kind: ticket.kind === 'image-generation' ? 'image' : ticket.kind,
    provider: ticket.provider || ticket.recoverySpec?.provider || payload.provider,
    modelId: ticket.recoverySpec?.modelId || ticket.recoverySpec?.model || ticket.recoverySpec?.payload?.modelId || ticket.recoverySpec?.payload?.model,
    nodeId: ticket.targetNodeId,
    canvasId: task.canvasId || task.unifiedTask?.canvasId || '',
    sourceNodeId: ticket.recoverySpec?.sourceNodeId || task.sourceNodeId || '',
    status,
    error: task.error || '',
    resultSpec: status === 'success' ? buildAsyncTaskResultSpec(payload, resultPatch) : null,
    canCancel: false,
    canResume: false,
    pollingSpec: ticket.recoverySpec,
    payload: ticket.recoverySpec?.payload || task.payload,
    createdAt: Number(ticket.startedAt || task.startedAt || task.createdAt || now) || now,
    updatedAt: task.updatedAt || now,
    finishedAt: task.finishedAt || now,
  }, {
    ...options,
    storage: options.asyncTaskStorage || options.storage,
    storageKey: options.asyncTaskStorageKey,
    now,
  });
}

function buildRunningTask(ticket = {}) {
  return {
    ...ticket.task,
    status: 'processing',
    startedAt: ticket.startedAt || ticket.task.startedAt,
    createdAt: ticket.startedAt || ticket.task.createdAt,
    recoverySpec: {
      ...ticket.recoverySpec,
      startedAt: ticket.startedAt || ticket.recoverySpec?.startedAt,
    },
    unifiedTask: ticket.task.unifiedTask ? {
      ...ticket.task.unifiedTask,
      status: 'running',
      canCancel: false,
      canRetry: false,
      canResume: true,
      error: null,
    } : ticket.task.unifiedTask,
  };
}

function applyRunningPatch(store, ticket = {}) {
  return applyNodeBackfill(store, 'running', buildRunningTask(ticket));
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

function createSession(tickets = [], manager, options = {}) {
  const store = options.store;
  const fetchFn = options.fetch || globalThis.fetch;
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const pollIntervalMs = Math.max(500, Number(options.pollIntervalMs ?? 2000) || 2000);
  const pollGraceMs = Math.max(0, Number(options.graceMs ?? 60000) || 0);
  const timers = new Set();
  const pending = new Set();
  const waitingTickets = new Map();
  let unsubscribeNodes = null;
  let stopped = false;

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
  };

  const schedule = (ticket) => {
    if (stopped) return;
    const timer = setTimer(() => {
      timers.delete(timer);
      void poll(ticket);
    }, pollIntervalMs);
    timers.add(timer);
  };

  const finish = async (ticket, status, payload = {}) => {
    const normalizedStatus = normalizeStatus(status);
    const resultPatch = normalizedStatus === 'success' ? await buildTerminalResultPatch(ticket, payload, options) : {};
    const task = {
      ...ticket.task,
      status: normalizedStatus,
      updatedAt: nowFrom(options),
      finishedAt: nowFrom(options),
      result: normalizedStatus === 'success' ? payload : ticket.task.result,
      error: normalizedStatus === 'success' ? '' : trimString(payload.error?.message || payload.error || payload.message) || '任务失败',
      recoverySpec: ticket.recoverySpec,
      unifiedTask: ticket.task.unifiedTask ? {
        ...ticket.task.unifiedTask,
        status: normalizedStatus,
        canCancel: false,
        canRetry: normalizedStatus !== 'success',
        canResume: false,
        error: normalizedStatus === 'success' ? null : payload.error || payload.message || '任务失败',
      } : ticket.task.unifiedTask,
    };
    applyNodeBackfill(store, normalizedStatus, task, resultPatch);
    syncAsyncTaskCache(ticket, task, resultPatch, payload, options);
    upsertManagerTask(manager, task);
  };

  async function poll(ticket) {
    if (stopped) return;
    return track((async () => {
      const isPastDeadline = nowFrom(options) > ticket.deadlineAt;
      const canPollPastDeadline = ticket.mode === 'local_proxy_poll' && ticket.confirmedBackendRunning === true;
      if (isPastDeadline && !canPollPastDeadline) {
        await finish(ticket, 'interrupted', { message: '恢复超时' });
        return;
      }
      const response = await fetchFn(createPollUrl(ticket));
      const payload = await readJsonResponse(response);
      const status = resolvePollStatus(ticket, payload);
      if (isTransientLocalProxyMissing(ticket, payload)) {
        if (isPastDeadline) {
          await finish(ticket, 'interrupted', { message: '恢复超时' });
          return;
        }
        applyRunningPatch(store, ticket);
        schedule(ticket);
        return;
      }
      if (payload.pending === true || PENDING_STATUSES.has(status)) {
        if (ticket.mode === 'local_proxy_poll') ticket.confirmedBackendRunning = true;
        applyRunningPatch(store, ticket);
        schedule(ticket);
        return;
      }
      if (TERMINAL_STATUSES.has(status)) {
        await finish(ticket, status, payload);
      }
    })());
  }

  const startTicket = (ticket) => {
    if (stopped) return false;
    refreshTicketStartedAtFromNode(ticket, store, pollGraceMs);
    if (!applyRunningPatch(store, ticket)) return false;
    void poll(ticket);
    return true;
  };

  const retryWaitingTickets = () => {
    if (stopped) return;
    for (const [id, ticket] of [...waitingTickets.entries()]) {
      if (startTicket(ticket)) waitingTickets.delete(id);
    }
    if (!waitingTickets.size && unsubscribeNodes) {
      try { unsubscribeNodes(); } catch {}
      unsubscribeNodes = null;
    }
  };

  tickets.forEach((ticket) => {
    if (!startTicket(ticket)) waitingTickets.set(ticket.id, ticket);
  });
  if (waitingTickets.size) unsubscribeNodes = subscribeStoreNodes(store, retryWaitingTickets);

  return {
    activeCount: tickets.length,
    stop() {
      stopped = true;
      if (unsubscribeNodes) {
        try { unsubscribeNodes(); } catch {}
        unsubscribeNodes = null;
      }
      waitingTickets.clear();
      timers.forEach((timer) => clearTimer(timer));
      timers.clear();
    },
    async flush() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}

export function startGenerationRecoveryV2(tasks = [], manager, options = {}) {
  const tickets = buildGenerationRecoveryV2Tickets(tasks, options);
  return createSession(tickets, manager, options);
}

export const __test__ = {
  buildGenerationRecoveryV2Tickets,
  createLocalProxyUrl,
  buildImageResultPatch,
};