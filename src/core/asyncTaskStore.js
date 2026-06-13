import {
  resolveAsyncTaskQueryableTaskId,
  resolveAsyncTaskRecoveryCapability,
  resolveAsyncTaskRemoteResultId,
  resolveLocalProxyClientTaskId,
} from './asyncTaskRecoveryCapabilities.js';

const DEFAULT_STORAGE_KEY = 'ai-canvas:async-tasks:v1';
const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_DONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(['queued', 'submitted', 'running', 'polling', 'processing', 'pending']);
const TERMINAL_STATUSES = new Set(['success', 'failed', 'cancelled', 'canceled', 'interrupted']);
const INTERRUPTED_LOCAL_PROXY_CANCEL_STATUSES = new Set(['cancelled', 'interrupted']);
const GENERATION_COMPATIBLE_KINDS = new Set(['provider_async', 'image', 'video', 'audio', 'text']);
const PLACEHOLDER_REMOTE_ID_MERGE_WINDOW_MS = 10 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password|credential|cookie|headers?|body|request)/i;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getStorage(options = {}) {
  return options.storage || globalThis.localStorage || null;
}

function getStorageKey(options = {}) {
  return trimString(options.storageKey) || DEFAULT_STORAGE_KEY;
}

function normalizeStatus(status) {
  const value = trimString(status).toLowerCase();
  if (value === 'canceled') return 'cancelled';
  if (['complete', 'completed', 'done', 'finished', 'succeeded'].includes(value)) return 'success';
  if (['error', 'errored', 'fail', 'failure'].includes(value)) return 'failed';
  if (['waiting', 'submitted', 'pending', 'processing', 'running'].includes(value)) return 'polling';
  return value || 'queued';
}

function sanitizePlainValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value == null) return value;
  if (['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePlainValue(item, depth + 1))
      .filter((item) => item !== undefined)
      .slice(0, 80);
  }
  if (typeof value !== 'object') return undefined;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizePlainValue(entry, depth + 1);
    if (sanitized !== undefined && sanitized !== '') output[key] = sanitized;
  }
  return output;
}

function sanitizeSpec(value) {
  const source = asObject(value);
  const output = {};
  for (const [key, entry] of Object.entries(source)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    const sanitized = sanitizePlainValue(entry);
    if (sanitized !== undefined && sanitized !== '') output[key] = sanitized;
  }
  return output;
}

function collectResultSpecSources(value = {}) {
  const source = asObject(value);
  const response = asObject(source.response);
  const body = asObject(source.body || response.body);
  const candidates = [
    source,
    asObject(source.result),
    asObject(source.output),
    asObject(source.data),
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

function sanitizeResultSpec(value) {
  const output = {};
  for (const source of collectResultSpecSources(value)) {
    for (const key of ['imageUrl', 'videoUrl', 'audioUrl', 'localPath', 'thumbUrl', 'displayLocalPath', 'posterLocalPath', 'sourceUrl']) {
      const text = trimString(source[key]);
      if (text && !output[key]) output[key] = text;
    }
  }
  return Object.keys(output).length ? output : null;
}

function isCompatibleGenerationKind(left = '', right = '') {
  const leftKind = trimString(left);
  const rightKind = trimString(right);
  if (leftKind === rightKind) return true;
  return GENERATION_COMPATIBLE_KINDS.has(leftKind) && GENERATION_COMPATIBLE_KINDS.has(rightKind);
}

function getRecordLocalIdentity(record = {}) {
  return {
    runtimeTaskId: trimString(record.runtimeTaskId || record.payload?.runtimeTaskId || record.pollingSpec?.runtimeTaskId),
    clientTaskId: trimString(record.clientTaskId || record.payload?.clientTaskId || record.pollingSpec?.clientTaskId),
  };
}

function hasSameLocalTaskIdentity(left = {}, right = {}) {
  const leftIdentity = getRecordLocalIdentity(left);
  const rightIdentity = getRecordLocalIdentity(right);
  return Boolean(
    (leftIdentity.runtimeTaskId && leftIdentity.runtimeTaskId === rightIdentity.runtimeTaskId)
      || (leftIdentity.clientTaskId && leftIdentity.clientTaskId === rightIdentity.clientTaskId)
  );
}

function isExplicitUserCancellation(source = {}) {
  const value = asObject(source);
  const reason = trimString(value.cancelReason || value.cancellationReason || value.reason || value.cancelSource || value.source).toLowerCase();
  return value.userCancelled === true
    || value.explicitCancel === true
    || value.explicitlyCancelled === true
    || value.cancelledByUser === true
    || reason === 'user'
    || reason === 'manual'
    || reason === 'explicit'
    || reason === 'user_cancel'
    || reason === 'user-cancel';
}

function shouldKeepLocalProxyCancellationRecoverable(source = {}, status = '', recoveryCapability = {}) {
  const value = asObject(source);
  if (!recoveryCapability.supportsLocalProxyRecovery) return false;
  if (!INTERRUPTED_LOCAL_PROXY_CANCEL_STATUSES.has(status)) return false;
  if (isExplicitUserCancellation(value)) return false;
  const { runtimeTaskId, clientTaskId } = getRecordLocalIdentity(value);
  if (!runtimeTaskId || !clientTaskId) return false;
  const pollingSpec = asObject(value.pollingSpec || value.recoverySpec);
  if (pollingSpec.resumable === false) return false;
  return true;
}

function getRecordRemoteIdentity(record = {}) {
  return trimString(record.queryableTaskId || record.pollingTaskId || record.remoteResultId || record.remoteTaskId || record.pollingSpec?.taskId);
}

function isPlaceholderAsyncTaskRecord(record = {}) {
  return !getRecordRemoteIdentity(record) && isAsyncTaskRecordActive(record);
}

function isSameTaskScope(left = {}, right = {}) {
  return trimString(left.nodeId) === trimString(right.nodeId)
    && trimString(left.provider) === trimString(right.provider)
    && isCompatibleGenerationKind(left.kind, right.kind);
}

function isLikelySameGenerationAttempt(left = {}, right = {}) {
  if (!isSameTaskScope(left, right)) return false;
  const leftCreatedAt = finiteNumber(left.createdAt, 0);
  const rightCreatedAt = finiteNumber(right.createdAt, 0);
  const rightUpdatedAt = finiteNumber(right.updatedAt, 0);
  if (leftCreatedAt && rightUpdatedAt && leftCreatedAt > rightUpdatedAt) return false;
  if (leftCreatedAt && rightCreatedAt && Math.abs(leftCreatedAt - rightCreatedAt) > PLACEHOLDER_REMOTE_ID_MERGE_WINDOW_MS) return false;
  const leftModelId = trimString(left.modelId);
  const rightModelId = trimString(right.modelId);
  if (leftModelId && rightModelId && leftModelId !== rightModelId) return false;
  const leftCanvasId = trimString(left.canvasId);
  const rightCanvasId = trimString(right.canvasId);
  if (leftCanvasId && rightCanvasId && leftCanvasId !== rightCanvasId) return false;
  return true;
}

function mergeAsyncTaskRecords(previous = {}, incoming = {}, options = {}) {
  const preserveIdentity = options.preserveIdentity === true;
  const incomingStatus = normalizeStatus(incoming.status);
  return {
    ...previous,
    ...incoming,
    ...(preserveIdentity ? {
      runtimeTaskId: previous.runtimeTaskId,
      nodeId: previous.nodeId,
      canvasId: previous.canvasId,
      sourceNodeId: previous.sourceNodeId,
      createdAt: previous.createdAt,
    } : {}),
    pollingSpec: { ...asObject(previous?.pollingSpec), ...asObject(incoming.pollingSpec) },
    payload: { ...asObject(previous?.payload), ...asObject(incoming.payload) },
    clientTaskId: incoming.clientTaskId || previous?.clientTaskId || '',
    resultSpec: ACTIVE_STATUSES.has(incomingStatus) ? null : (incoming.resultSpec || previous?.resultSpec || null),
  };
}

function compactLocalIdentityAsyncTaskRecords(records = []) {
  const items = Array.isArray(records) ? records.filter(Boolean) : [];
  const removedIndexes = new Set();
  for (let currentIndex = 0; currentIndex < items.length; currentIndex += 1) {
    if (removedIndexes.has(currentIndex)) continue;
    let current = items[currentIndex];
    for (let duplicateIndex = currentIndex + 1; duplicateIndex < items.length; duplicateIndex += 1) {
      if (removedIndexes.has(duplicateIndex)) continue;
      const duplicate = items[duplicateIndex];
      if (!hasSameLocalTaskIdentity(current, duplicate)) continue;
      if (!isSameTaskScope(current, duplicate)) continue;
      const currentUpdatedAt = finiteNumber(current.updatedAt, 0);
      const duplicateUpdatedAt = finiteNumber(duplicate.updatedAt, 0);
      const newer = duplicateUpdatedAt > currentUpdatedAt ? duplicate : current;
      const older = newer === duplicate ? current : duplicate;
      items[currentIndex] = mergeAsyncTaskRecords(older, newer, { preserveIdentity: true });
      current = items[currentIndex];
      removedIndexes.add(duplicateIndex);
    }
  }
  return items.filter((_, index) => !removedIndexes.has(index));
}

function compactAsyncTaskRecords(records = []) {
  const items = compactLocalIdentityAsyncTaskRecords(Array.isArray(records) ? records.filter(Boolean) : []);
  const removedIndexes = new Set();
  for (let incomingIndex = 0; incomingIndex < items.length; incomingIndex += 1) {
    if (removedIndexes.has(incomingIndex)) continue;
    const incoming = items[incomingIndex];
    if (!getRecordRemoteIdentity(incoming)) continue;
    for (let placeholderIndex = 0; placeholderIndex < items.length; placeholderIndex += 1) {
      if (incomingIndex === placeholderIndex || removedIndexes.has(placeholderIndex)) continue;
      const placeholder = items[placeholderIndex];
      if (!isPlaceholderAsyncTaskRecord(placeholder)) continue;
      if (!isLikelySameGenerationAttempt(placeholder, incoming)) continue;
      items[incomingIndex] = mergeAsyncTaskRecords(placeholder, incoming, { preserveIdentity: true });
      removedIndexes.add(placeholderIndex);
      break;
    }
  }
  return items.filter((_, index) => !removedIndexes.has(index));
}

export function createAsyncRuntimeTaskId({ kind = '', provider = '', nodeId = '', remoteTaskId = '', pollingTaskId = '', now = Date.now() } = {}) {
  const safeKind = trimString(kind) || 'async';
  const safeProvider = trimString(provider) || 'provider';
  const safeNodeId = trimString(nodeId) || 'node';
  const safeRemoteTaskId = trimString(remoteTaskId || pollingTaskId);
  return ['async', safeKind, safeProvider, safeNodeId, safeRemoteTaskId || String(finiteNumber(now, Date.now()))]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_.:-]+/g, '_'))
    .join(':');
}

export function sanitizeAsyncTaskRecord(record = {}, options = {}) {
  const source = asObject(record);
  const kind = trimString(source.kind || source.taskType || source.type) || 'provider_async';
  const provider = trimString(source.provider || source.pollingSpec?.provider || source.payload?.provider);
  const rawStatus = normalizeStatus(source.status);
  const legacyRemoteTaskId = trimString(source.remoteTaskId);
  const recoveryCapability = resolveAsyncTaskRecoveryCapability(source);
  const shouldRecoverInterruptedLocalProxyTask = shouldKeepLocalProxyCancellationRecoverable(source, rawStatus, recoveryCapability);
  const status = shouldRecoverInterruptedLocalProxyTask ? 'polling' : rawStatus;
  const queryableTaskId = resolveAsyncTaskQueryableTaskId(source);
  const directPollingTaskId = queryableTaskId;
  const remoteResultId = resolveAsyncTaskRemoteResultId(source);
  const terminalRemoteTaskId = trimString(source.resultRemoteTaskId || (TERMINAL_STATUSES.has(status) ? remoteResultId || legacyRemoteTaskId : ''));
  const pollingTaskId = trimString(directPollingTaskId);
  const remoteTaskId = TERMINAL_STATUSES.has(status) ? terminalRemoteTaskId : legacyRemoteTaskId;
  const clientTaskIdExplicit = trimString(source.clientTaskId || source.payload?.clientTaskId || source.pollingSpec?.clientTaskId);
  const nodeId = trimString(source.nodeId || source.targetNodeId || source.pollingSpec?.targetNodeId || source.payload?.nodeId || source.payload?.targetNodeId);
  const explicitRuntimeTaskId = trimString(source.runtimeTaskId || source.id || source.payload?.runtimeTaskId || source.pollingSpec?.runtimeTaskId);
  const clientTaskId = recoveryCapability.supportsLocalProxyRecovery
    ? resolveLocalProxyClientTaskId(source, explicitRuntimeTaskId, clientTaskIdExplicit)
    : clientTaskIdExplicit;
  const hasLocalRecoveryCredential = Boolean(explicitRuntimeTaskId && clientTaskId);
  if (recoveryCapability.supportsLocalProxyRecovery && !nodeId) return null;
  if (recoveryCapability.supportsLocalProxyRecovery && ACTIVE_STATUSES.has(status) && source.canResume !== false && !hasLocalRecoveryCredential) return null;
  const now = finiteNumber(options.now, Date.now());
  const runtimeTaskId = explicitRuntimeTaskId || createAsyncRuntimeTaskId({
    kind,
    provider,
    nodeId,
    remoteTaskId,
    pollingTaskId,
    now,
  });
  if (!runtimeTaskId || (!pollingTaskId && !remoteTaskId && kind !== 'media' && !nodeId)) return null;

  const createdAt = finiteNumber(source.createdAt || source.startedAt, now);
  const updatedAt = finiteNumber(source.updatedAt, now);

  return {
    version: 1,
    runtimeTaskId,
    clientTaskId,
    remoteTaskId,
    remoteResultId: remoteResultId || terminalRemoteTaskId,
    queryableTaskId,
    pollingTaskId,
    recoveryMode: recoveryCapability.recoveryMode,
    recoveryCapability,
    providerCapabilities: recoveryCapability,
    kind,
    provider,
    modelId: trimString(source.modelId || source.model || source.pollingSpec?.modelId || source.pollingSpec?.model),
    nodeId,
    canvasId: trimString(source.canvasId),
    sourceNodeId: trimString(source.sourceNodeId),
    status,
    title: trimString(source.title),
    message: trimString(source.message),
    error: shouldRecoverInterruptedLocalProxyTask ? '' : trimString(source.error?.message || source.error).slice(0, 2000),
    progress: Number.isFinite(Number(source.progress)) ? Math.max(0, Math.min(1, Number(source.progress))) : null,
    canCancel: shouldRecoverInterruptedLocalProxyTask ? false : source.canCancel === true,
    canResume: shouldRecoverInterruptedLocalProxyTask ? true : source.canResume !== false,
    cancellationReason: isExplicitUserCancellation(source) ? 'user' : '',
    pollingSpec: sanitizeSpec(source.pollingSpec || source.recoverySpec || source.taskMeta),
    payload: sanitizeSpec(source.payload),
    resultSpec: ACTIVE_STATUSES.has(status) ? null : sanitizeResultSpec(source.resultSpec || source.result),
    createdAt,
    updatedAt,
    finishedAt: TERMINAL_STATUSES.has(status) ? finiteNumber(source.finishedAt, updatedAt) : 0,
    attempt: Math.max(0, finiteNumber(source.attempt, 0)),
  };
}

export function serializeAsyncTaskSnapshot(records = [], options = {}) {
  const now = finiteNumber(options.now, Date.now());
  const maxRecords = Math.max(1, finiteNumber(options.maxRecords, DEFAULT_MAX_RECORDS));
  const retentionMs = Math.max(0, finiteNumber(options.doneRetentionMs, DEFAULT_DONE_RETENTION_MS));
  const items = compactAsyncTaskRecords((Array.isArray(records) ? records : Array.from(records || []))
    .map((entry) => Array.isArray(entry) ? entry[1] : entry)
    .map((record) => sanitizeAsyncTaskRecord(record, { now }))
    .filter(Boolean))
    .filter((record) => !TERMINAL_STATUSES.has(record.status) || !record.finishedAt || now - record.finishedAt <= retentionMs)
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, maxRecords);
  return { version: 1, savedAt: now, items };
}

export function loadAsyncTaskRecords(options = {}) {
  const storage = getStorage(options);
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const parsed = JSON.parse(storage.getItem(getStorageKey(options)) || '{}');
    return compactAsyncTaskRecords((Array.isArray(parsed.items) ? parsed.items : [])
      .map((item) => sanitizeAsyncTaskRecord(item, options))
      .filter(Boolean));
  } catch {
    return [];
  }
}

export function saveAsyncTaskRecords(records = [], options = {}) {
  const storage = getStorage(options);
  if (!storage || typeof storage.setItem !== 'function') return null;
  const snapshot = serializeAsyncTaskSnapshot(records, options);
  try {
    storage.setItem(getStorageKey(options), JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null;
  }
}

export function upsertAsyncTaskRecord(record = {}, options = {}) {
  const normalized = sanitizeAsyncTaskRecord(record, options);
  if (!normalized) return null;
  const records = loadAsyncTaskRecords(options);
  let index = records.findIndex((item) => item.runtimeTaskId === normalized.runtimeTaskId);
  let shouldPreserveRecordIdentity = false;
  const matchesRecordScope = (item) => trimString(item.nodeId) === normalized.nodeId
    && trimString(item.provider) === normalized.provider
    && isCompatibleGenerationKind(item.kind, normalized.kind);
  const matchesActiveRecordScope = (item) => matchesRecordScope(item) && isAsyncTaskRecordActive(item);
  if (index < 0 && normalized.clientTaskId) {
    index = records.findIndex((item) => trimString(item.clientTaskId) === normalized.clientTaskId && matchesRecordScope(item));
    if (index >= 0) shouldPreserveRecordIdentity = true;
  }
  if (index < 0 && (normalized.runtimeTaskId || normalized.clientTaskId)) {
    index = records.findIndex((item) => hasSameLocalTaskIdentity(item, normalized) && matchesRecordScope(item));
    if (index >= 0) shouldPreserveRecordIdentity = true;
  }
  if (index < 0 && (normalized.pollingTaskId || (TERMINAL_STATUSES.has(normalized.status) && normalized.remoteTaskId))) {
    if (normalized.pollingTaskId) {
      index = records.findIndex((item) => trimString(item.pollingTaskId) === normalized.pollingTaskId && matchesActiveRecordScope(item));
      if (index >= 0) shouldPreserveRecordIdentity = true;
    }
    if (index < 0) {
      index = records.findIndex((item) => !trimString(item.pollingTaskId || item.remoteTaskId) && matchesActiveRecordScope(item));
      if (index >= 0) shouldPreserveRecordIdentity = true;
    }
    if (index < 0 && TERMINAL_STATUSES.has(normalized.status) && normalized.remoteTaskId) {
      index = records.findIndex((item) => trimString(item.pollingTaskId) === normalized.remoteTaskId && matchesActiveRecordScope(item));
      if (index >= 0) shouldPreserveRecordIdentity = true;
    }
    if (index < 0 && TERMINAL_STATUSES.has(normalized.status) && normalized.remoteTaskId) {
      index = records.findIndex((item) => trimString(item.remoteTaskId || item.remoteResultId) === normalized.remoteTaskId && matchesActiveRecordScope(item));
      if (index >= 0) shouldPreserveRecordIdentity = true;
    }
  }
  if (index < 0 && normalized.pollingTaskId && !normalized.nodeId) {
    const candidates = records
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => !trimString(item.pollingTaskId || item.remoteTaskId)
        && trimString(item.provider) === normalized.provider
        && isCompatibleGenerationKind(item.kind, normalized.kind)
        && isAsyncTaskRecordActive(item));
    if (candidates.length === 1) {
      index = candidates[0].itemIndex;
      shouldPreserveRecordIdentity = true;
    }
  }
  const previous = index >= 0 ? records[index] : null;
  shouldPreserveRecordIdentity = shouldPreserveRecordIdentity || Boolean(previous
    && previous.runtimeTaskId !== normalized.runtimeTaskId
    && (normalized.pollingTaskId || (TERMINAL_STATUSES.has(normalized.status) && normalized.remoteTaskId))
    && !trimString(previous.pollingTaskId || previous.remoteTaskId));
  const next = mergeAsyncTaskRecords(previous || {}, normalized, { preserveIdentity: shouldPreserveRecordIdentity });
  if (index >= 0) records[index] = next;
  else records.unshift(next);
  const outputRecords = TERMINAL_STATUSES.has(next.status)
    ? records.filter((item) => {
      if (item === next) return true;
      if (trimString(item.nodeId) !== next.nodeId
        || trimString(item.provider) !== next.provider
        || !isCompatibleGenerationKind(item.kind, next.kind)
        || !isAsyncTaskRecordActive(item)) return true;
      if (hasSameLocalTaskIdentity(item, next) && isSameTaskScope(item, next)) return false;
      const itemPollingTaskId = trimString(item.pollingTaskId);
      const itemRemoteTaskId = trimString(item.remoteTaskId);
      if (!trimString(itemPollingTaskId || itemRemoteTaskId)) return false;
      if (next.remoteTaskId && itemPollingTaskId === next.remoteTaskId) return false;
      return true;
    })
    : records;
  saveAsyncTaskRecords(compactAsyncTaskRecords(outputRecords), options);
  return next;
}

export function updateAsyncTaskRecord(runtimeTaskId = '', patch = {}, options = {}) {
  const id = trimString(runtimeTaskId);
  if (!id) return null;
  const records = loadAsyncTaskRecords(options);
  const index = records.findIndex((item) => item.runtimeTaskId === id);
  if (index < 0) return null;
  const next = sanitizeAsyncTaskRecord({ ...records[index], ...asObject(patch), runtimeTaskId: id }, options);
  if (!next) return null;
  records[index] = next;
  saveAsyncTaskRecords(records, options);
  return next;
}

export function removeAsyncTaskRecord(runtimeTaskId = '', options = {}) {
  const id = trimString(runtimeTaskId);
  if (!id) return false;
  const records = loadAsyncTaskRecords(options);
  const next = records.filter((item) => item.runtimeTaskId !== id);
  if (next.length === records.length) return false;
  saveAsyncTaskRecords(next, options);
  return true;
}

export function isAsyncTaskRecordActive(record = {}) {
  return ACTIVE_STATUSES.has(normalizeStatus(record.status));
}

export const __test__ = {
  ACTIVE_STATUSES,
  DEFAULT_STORAGE_KEY,
  SENSITIVE_KEY_PATTERN,
  TERMINAL_STATUSES,
  normalizeStatus,
  sanitizePlainValue,
};
