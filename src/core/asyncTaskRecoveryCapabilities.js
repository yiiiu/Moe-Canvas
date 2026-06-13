const REMOTE_POLL_PROVIDERS = new Set([
  'runninghub',
  'runninghubwf',
  'runninghub-workflow',
  'runninghub_workflow',
  'dreamina',
  'apimart',
  'workflow',
]);

const LOCAL_PROXY_RECOVERY_PROVIDERS = new Set([
  'grsai',
]);

export const ASYNC_TASK_RECOVERY_MODES = Object.freeze({
  REMOTE_POLL: 'remote_poll',
  LOCAL_PROXY_POLL: 'local_proxy_poll',
  IMMEDIATE_RESULT: 'immediate_result',
  NONE: 'none',
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value = '') {
  return trimString(value).toLowerCase();
}

function normalizeMode(value = '') {
  const mode = trimString(value).toLowerCase();
  return Object.values(ASYNC_TASK_RECOVERY_MODES).includes(mode) ? mode : '';
}

function pickProvider(value = {}) {
  const source = asObject(value);
  const direct = normalizeProvider(source.provider
    || source.pollingSpec?.provider
    || source.recoverySpec?.provider
    || source.payload?.provider
    || source.taskMeta?.provider);
  if (direct) return direct;
  return inferProviderFromRecoveryHints(source);
}

function inferProviderFromRecoveryHints(source = {}) {
  const value = asObject(source);
  const pollingSpec = asObject(value.pollingSpec || value.recoverySpec);
  const payload = asObject(value.payload);
  const taskMeta = asObject(value.taskMeta);
  const hints = [
    value.taskId,
    value.asyncTaskId,
    value.runtimeTaskId,
    value.clientTaskId,
    value.remoteTaskId,
    value.pollingTaskId,
    value.queryableTaskId,
    pollingSpec.taskId,
    pollingSpec.runtimeTaskId,
    pollingSpec.clientTaskId,
    pollingSpec.pollingTaskId,
    pollingSpec.queryableTaskId,
    pollingSpec.taskPolling?.urlTemplate,
    payload.taskId,
    payload.runtimeTaskId,
    payload.clientTaskId,
    payload.taskPolling?.urlTemplate,
    taskMeta.taskPolling?.urlTemplate,
  ].map(trimString).join('\n').toLowerCase();
  if (hints.includes('grsai') || hints.includes('grsai.dakka.com.cn')) return 'grsai';
  return '';
}

export function getProviderRecoveryCapability(provider = '', hints = {}) {
  const normalizedProvider = normalizeProvider(provider);
  const source = asObject(hints);
  const explicitMode = normalizeMode(source.recoveryMode);

  if (LOCAL_PROXY_RECOVERY_PROVIDERS.has(normalizedProvider)) {
    return {
      provider: normalizedProvider,
      recoveryMode: ASYNC_TASK_RECOVERY_MODES.LOCAL_PROXY_POLL,
      supportsRemotePoll: false,
      returnsImmediateResult: true,
      supportsLocalProxyRecovery: true,
      requiresQueryableTaskId: false,
    };
  }

  if (explicitMode) {
    return {
      provider: normalizedProvider,
      recoveryMode: explicitMode,
      supportsRemotePoll: explicitMode === ASYNC_TASK_RECOVERY_MODES.REMOTE_POLL,
      returnsImmediateResult: explicitMode === ASYNC_TASK_RECOVERY_MODES.IMMEDIATE_RESULT,
      supportsLocalProxyRecovery: explicitMode === ASYNC_TASK_RECOVERY_MODES.LOCAL_PROXY_POLL,
      requiresQueryableTaskId: explicitMode === ASYNC_TASK_RECOVERY_MODES.REMOTE_POLL,
    };
  }

  if (REMOTE_POLL_PROVIDERS.has(normalizedProvider) || source.taskPolling || source.pollingSpec?.taskPolling) {
    return {
      provider: normalizedProvider,
      recoveryMode: ASYNC_TASK_RECOVERY_MODES.REMOTE_POLL,
      supportsRemotePoll: true,
      returnsImmediateResult: false,
      supportsLocalProxyRecovery: false,
      requiresQueryableTaskId: true,
    };
  }

  return {
    provider: normalizedProvider,
    recoveryMode: ASYNC_TASK_RECOVERY_MODES.NONE,
    supportsRemotePoll: false,
    returnsImmediateResult: false,
    supportsLocalProxyRecovery: false,
    requiresQueryableTaskId: false,
  };
}

export function resolveAsyncTaskRecoveryCapability(record = {}) {
  const source = asObject(record);
  const embedded = asObject(source.recoveryCapability || source.providerCapabilities);
  const provider = pickProvider(source);
  const base = getProviderRecoveryCapability(provider, {
    ...embedded,
    recoveryMode: source.recoveryMode || embedded.recoveryMode,
    taskPolling: source.pollingSpec?.taskPolling || source.recoverySpec?.taskPolling || source.payload?.taskPolling,
    pollingSpec: source.pollingSpec || source.recoverySpec,
  });
  return {
    ...base,
    ...embedded,
    provider: base.provider,
    recoveryMode: base.recoveryMode,
    supportsRemotePoll: base.supportsRemotePoll === true,
    returnsImmediateResult: base.returnsImmediateResult === true,
    supportsLocalProxyRecovery: base.supportsLocalProxyRecovery === true,
    requiresQueryableTaskId: base.requiresQueryableTaskId === true,
  };
}

export function resolveAsyncTaskQueryableTaskId(record = {}) {
  const source = asObject(record);
  const capability = resolveAsyncTaskRecoveryCapability(source);
  if (!capability.supportsRemotePoll) return '';
  return trimString(source.queryableTaskId
    || source.pollingTaskId
    || source.pollTaskId
    || source.recoveryTaskId
    || source.providerTaskId
    || source.pollingSpec?.queryableTaskId
    || source.pollingSpec?.pollingTaskId
    || source.pollingSpec?.taskId);
}

export function resolveAsyncTaskRemoteResultId(record = {}) {
  const source = asObject(record);
  const result = asObject(source.result);
  const resultSpec = asObject(source.resultSpec);
  return trimString(source.remoteResultId
    || source.resultRemoteTaskId
    || source.resultId
    || result.remoteResultId
    || result.resultRemoteTaskId
    || result.resultId
    || result.id
    || resultSpec.remoteResultId
    || resultSpec.resultId
    || source.remoteTaskId);
}

function isGrsaiLocalRuntimeTaskId(value = '') {
  const text = trimString(value).toLowerCase();
  return text.startsWith('async:image:grsai:') || text.startsWith('async:grsai:') || text.includes(':grsai:');
}

function isResultDerivedRuntimeTaskId(runtimeTaskId = '', remoteResultId = '') {
  const runtime = trimString(runtimeTaskId);
  const resultId = trimString(remoteResultId);
  return Boolean(resultId) && runtime.endsWith(`:${resultId}`);
}

export function resolveLocalProxyClientTaskId(record = {}, runtimeTaskId = '', explicitClientTaskId = '') {
  const explicit = trimString(explicitClientTaskId);
  if (explicit) return explicit;
  const runtime = trimString(runtimeTaskId);
  if (!runtime) return '';
  if (isResultDerivedRuntimeTaskId(runtime, resolveAsyncTaskRemoteResultId(record))) return '';
  return `client:${runtime}`;
}

function resolveLocalProxyCredentialParts(record = {}) {
  const source = asObject(record);
  const pollingSpec = asObject(source.pollingSpec || source.recoverySpec);
  const payload = asObject(source.payload);
  const runtimeTaskId = trimString(source.runtimeTaskId || pollingSpec.runtimeTaskId || payload.runtimeTaskId);
  const explicitClientTaskId = trimString(source.clientTaskId || pollingSpec.clientTaskId || payload.clientTaskId);
  const clientTaskId = resolveLocalProxyClientTaskId(source, runtimeTaskId, explicitClientTaskId);
  return { runtimeTaskId, clientTaskId };
}

export function resolveAsyncTaskLocalRecoveryTaskId(record = {}) {
  const source = asObject(record);
  const capability = resolveAsyncTaskRecoveryCapability(source);
  if (!capability.supportsLocalProxyRecovery) return '';
  const { runtimeTaskId, clientTaskId } = resolveLocalProxyCredentialParts(source);
  return runtimeTaskId || clientTaskId;
}

export function hasAsyncTaskLocalRecoveryCredential(record = {}) {
  const source = asObject(record);
  const capability = resolveAsyncTaskRecoveryCapability(source);
  if (!capability.supportsLocalProxyRecovery) return false;
  const { runtimeTaskId, clientTaskId } = resolveLocalProxyCredentialParts(source);
  return Boolean(runtimeTaskId && clientTaskId);
}