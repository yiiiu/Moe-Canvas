import {
  CUSTOM_PROVIDER_KIND,
  CUSTOM_PROVIDER_MODEL_CAPABILITIES,
  normalizeCustomProvidersRegistry,
} from '../../api/customProviderRegistry.js';

const CUSTOM_PROVIDER_RUNTIME_SOURCE = 'runtime.custom-providers';
const CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT = 'custom-provider-runtime-changed';
const CUSTOM_PROVIDER_RUNTIME_DESCRIPTION = 'Runtime custom OpenAI-compatible model';
const CUSTOM_PROVIDER_RUNTIME_ICON = 'custom-provider';
const CAPABILITY_ENDPOINTS = Object.freeze({
  text: '/v1/chat/completions',
  image: '/v1/images/generations',
  video: '/v1/videos/generations',
  audio: '/v1/audio/speech',
});

let runtimeState = createEmptyRuntimeState();

function createEmptyRuntimeState() {
  return {
    sourceId: CUSTOM_PROVIDER_RUNTIME_SOURCE,
    customProviders: [],
    models: [],
    modelByCanonicalId: new Map(),
    modelCandidatesByRawId: new Map(),
    executions: [],
    executionById: new Map(),
  };
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function createExecutionId(providerId, capability) {
  return `${providerId}.custom-openai-compatible.${capability}.v1`;
}

function createCanonicalModelId(providerId, modelId) {
  return `${providerId}/${modelId}`;
}

function createInputSlots(capability) {
  if (capability === 'text') {
    return Object.freeze({
      allowedKinds: Object.freeze(['text', 'image']),
      minByKind: Object.freeze({ text: 0, image: 0 }),
      maxByKind: Object.freeze({ image: 8, video: 0, audio: 0 }),
    });
  }

  if (capability === 'image') {
    return Object.freeze({
      allowedKinds: Object.freeze(['image', 'text']),
      minByKind: Object.freeze({ text: 0, image: 0 }),
      maxByKind: Object.freeze({ image: 8, video: 0, audio: 0 }),
    });
  }

  if (capability === 'video') {
    return Object.freeze({
      allowedKinds: Object.freeze(['image', 'video', 'audio', 'text']),
      minByKind: Object.freeze({ text: 0, image: 0, video: 0, audio: 0 }),
      maxByKind: Object.freeze({ image: 8, video: 4, audio: 4 }),
    });
  }

  return Object.freeze({
    allowedKinds: Object.freeze(['audio', 'text']),
    minByKind: Object.freeze({ text: 0, audio: 0 }),
    maxByKind: Object.freeze({ image: 0, video: 0, audio: 4 }),
  });
}

function createResponseMapping(capability) {
  if (capability === 'text') {
    return Object.freeze({
      resultPaths: Object.freeze([
        'choices[].message.content',
        'choices[].delta.content',
        'output_text',
        'text',
      ]),
    });
  }

  if (capability === 'image') {
    return Object.freeze({
      resultPaths: Object.freeze(['data[].url', 'data[].b64_json', 'result.url', 'url']),
    });
  }

  if (capability === 'video') {
    return Object.freeze({
      resultPaths: Object.freeze([
        'data[].url',
        'data[].video_url',
        'result.url',
        'result.video_url',
        'url',
      ]),
    });
  }

  return Object.freeze({
    resultPaths: Object.freeze(['data[].url', 'result.url', 'url']),
  });
}

function createResultShape(capability) {
  if (capability === 'text') {
    return Object.freeze({
      textFields: Object.freeze(['choices[].message.content', 'output_text', 'text']),
    });
  }

  if (capability === 'image') {
    return Object.freeze({
      imageFields: Object.freeze(['data[].url', 'data[].b64_json', 'result.url', 'url']),
    });
  }

  if (capability === 'video') {
    return Object.freeze({
      videoFields: Object.freeze([
        'data[].url',
        'data[].video_url',
        'result.url',
        'result.video_url',
        'url',
      ]),
    });
  }

  return Object.freeze({
    audioFields: Object.freeze(['data[].url', 'result.url', 'url']),
  });
}

function createBodyMapping(capability) {
  if (capability === 'image') {
    return Object.freeze({
      entries: Object.freeze([
        Object.freeze({ path: 'model', from: 'model' }),
        Object.freeze({ path: 'prompt', from: 'prompt' }),
        Object.freeze({ path: 'image', from: 'inputImages', transform: 'first', omitWhenEmpty: true }),
      ]),
    });
  }

  if (capability === 'video') {
    return Object.freeze({
      entries: Object.freeze([
        Object.freeze({ path: 'model', from: 'model' }),
        Object.freeze({ path: 'prompt', from: 'prompt' }),
        Object.freeze({ path: 'image', from: 'inputImages', transform: 'first', omitWhenEmpty: true }),
        Object.freeze({ path: 'video', from: 'inputVideos', transform: 'first', omitWhenEmpty: true }),
        Object.freeze({ path: 'audio', from: 'inputAudios', transform: 'first', omitWhenEmpty: true }),
      ]),
    });
  }

  if (capability === 'audio') {
    return Object.freeze({
      entries: Object.freeze([
        Object.freeze({ path: 'model', from: 'model' }),
        Object.freeze({ path: 'input', from: 'prompt' }),
      ]),
    });
  }

  return Object.freeze({
    entries: Object.freeze([
      Object.freeze({ path: 'model', from: 'model' }),
      Object.freeze({ path: 'messages', from: 'constant', value: [] }),
    ]),
  });
}

function createExecutionManifest(customProvider, capability) {
  return Object.freeze({
    schemaVersion: '1.0',
    id: createExecutionId(customProvider.id, capability),
    provider: customProvider.id,
    kind: capability,
    adapterType: 'modelApi',
    endpoint: CAPABILITY_ENDPOINTS[capability],
    endpointMode: capability === 'text' ? 'chat-completion' : undefined,
    method: 'POST',
    model: '',
    headers: Object.freeze({ 'Content-Type': 'application/json' }),
    bodyMapping: createBodyMapping(capability),
    responseMapping: createResponseMapping(capability),
    result: createResultShape(capability),
    extensions: Object.freeze({
      source: 'runtime',
      customProviderKind: CUSTOM_PROVIDER_KIND,
      customProviderId: customProvider.id,
      capability,
    }),
  });
}

function createModelManifest(customProvider, capability, rawModelId) {
  const canonicalModelId = createCanonicalModelId(customProvider.id, rawModelId);
  return Object.freeze({
    schemaVersion: '1.0',
    modelId: canonicalModelId,
    aliases: Object.freeze([rawModelId]),
    provider: customProvider.id,
    kind: capability,
    adapterType: 'modelApi',
    executionId: createExecutionId(customProvider.id, capability),
    displayName: rawModelId,
    icon: CUSTOM_PROVIDER_RUNTIME_ICON,
    description: CUSTOM_PROVIDER_RUNTIME_DESCRIPTION,
    inputSlots: createInputSlots(capability),
    uiSchema: Object.freeze({ fields: Object.freeze([]) }),
    async: capability !== 'text',
    cancellable: capability === 'video',
    outputType: capability,
    source: 'runtime',
    extensions: Object.freeze({
      source: 'runtime',
      customProviderKind: CUSTOM_PROVIDER_KIND,
      customProviderId: customProvider.id,
      capability,
      rawModelId,
    }),
  });
}

function addRawModelCandidate(state, rawModelId, manifest) {
  const key = normalizeText(rawModelId);
  if (!key) {
    return;
  }
  const existing = state.modelCandidatesByRawId.get(key) || [];
  existing.push(manifest);
  state.modelCandidatesByRawId.set(key, existing);
}

function buildRuntimeState(customProviders = []) {
  const normalizedCustomProviders = normalizeCustomProvidersRegistry(customProviders).filter(
    provider => provider.enabled !== false && provider.kind === CUSTOM_PROVIDER_KIND,
  );
  const nextState = createEmptyRuntimeState();
  nextState.customProviders = cloneValue(normalizedCustomProviders);

  for (const customProvider of normalizedCustomProviders) {
    for (const capability of CUSTOM_PROVIDER_MODEL_CAPABILITIES) {
      if (!customProvider.capabilities.includes(capability)) {
        continue;
      }

      const models = Array.isArray(customProvider.models?.[capability])
        ? customProvider.models[capability]
        : [];
      if (models.length === 0) {
        continue;
      }

      const executionManifest = createExecutionManifest(customProvider, capability);
      nextState.executions.push(executionManifest);
      nextState.executionById.set(executionManifest.id, executionManifest);

      for (const rawModelId of models) {
        const normalizedModelId = normalizeText(rawModelId);
        if (!normalizedModelId) {
          continue;
        }
        const modelManifest = createModelManifest(customProvider, capability, normalizedModelId);
        nextState.models.push(modelManifest);
        nextState.modelByCanonicalId.set(modelManifest.modelId, modelManifest);
        addRawModelCandidate(nextState, normalizedModelId, modelManifest);
      }
    }
  }

  return nextState;
}

function normalizeProviderHint(providerHint) {
  return normalizeText(providerHint).toLowerCase();
}

function resolveProviderHint(options = {}) {
  if (typeof options === 'string') {
    return normalizeProviderHint(options);
  }
  return normalizeProviderHint(options.providerHint || options.provider || options.expectedProvider);
}

function findModelManifestByRawId(rawModelId, providerHint = '') {
  const candidates = runtimeState.modelCandidatesByRawId.get(normalizeText(rawModelId)) || [];
  if (candidates.length === 0) {
    return null;
  }

  if (providerHint) {
    return (
      candidates.find(
        manifest => normalizeProviderHint(manifest.provider) === normalizeProviderHint(providerHint),
      ) || null
    );
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function dispatchRuntimeChanged(reason) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  const detail = getCustomProviderRuntimeState();
  detail.reason = reason || 'updated';

  try {
    window.dispatchEvent(new CustomEvent(CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT, { detail }));
  } catch {
    window.dispatchEvent(new Event(CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT));
  }
}

export function clearCustomProviderRuntimeManifests() {
  runtimeState = createEmptyRuntimeState();
  dispatchRuntimeChanged('cleared');
}

export function setCustomProviderRuntimeManifests(customProviders = []) {
  runtimeState = buildRuntimeState(customProviders);
  const bundle = {
    sourceId: runtimeState.sourceId,
    models: runtimeState.models,
    executions: runtimeState.executions,
  };
  dispatchRuntimeChanged('updated');
  return bundle;
}

export { CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT };

export function listCustomProviderRuntimeModelManifests() {
  return runtimeState.models;
}

export function listCustomProviderRuntimeExecutionManifests() {
  return runtimeState.executions;
}

export function getCustomProviderRuntimeModelManifest(modelId, providerHint = '') {
  const canonicalModelId = normalizeText(modelId);
  if (!canonicalModelId) {
    return null;
  }

  const directMatch = runtimeState.modelByCanonicalId.get(canonicalModelId);
  if (directMatch) {
    return directMatch;
  }

  return findModelManifestByRawId(canonicalModelId, providerHint);
}

export function getCustomProviderRuntimeExecutionManifest(executionId) {
  return runtimeState.executionById.get(normalizeText(executionId)) || null;
}

export function resolveCustomProviderRuntimeExecution(modelId, options = {}) {
  const providerHint = resolveProviderHint(options);
  const modelManifest = getCustomProviderRuntimeModelManifest(modelId, providerHint);
  if (!modelManifest) {
    return null;
  }

  const executionManifest = getCustomProviderRuntimeExecutionManifest(modelManifest.executionId);
  if (!executionManifest) {
    return null;
  }

  return {
    modelManifest,
    executionManifest,
    inputModelId: normalizeText(modelId),
    canonicalModelId: modelManifest.modelId,
    source: 'runtime.custom-provider',
  };
}

export function getCustomProviderRuntimeManifestBundle() {
  return {
    sourceId: runtimeState.sourceId,
    models: runtimeState.models,
    executions: runtimeState.executions,
  };
}

export function getCustomProviderRuntimeState() {
  return cloneValue({
    sourceId: runtimeState.sourceId,
    customProviders: runtimeState.customProviders,
    models: runtimeState.models,
    executions: runtimeState.executions,
  });
}