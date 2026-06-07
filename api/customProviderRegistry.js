const CUSTOM_PROVIDER_PREFIX = 'custom_';
const CUSTOM_PROVIDER_KIND = 'openai-compatible';
const LEGACY_OPENAI_PROVIDER_ID = 'openai';
const LEGACY_OPENAI_CUSTOM_PROVIDER_ID = 'custom_openai_compatible';
const LEGACY_OPENAI_CUSTOM_PROVIDER_LABEL = 'OpenAI 兼容';
const CUSTOM_PROVIDER_CAPABILITIES = Object.freeze([
  'text',
  'image',
  'video',
  'audio',
  'connection_test',
]);
const CUSTOM_PROVIDER_MODEL_CAPABILITIES = Object.freeze([
  'text',
  'image',
  'video',
  'audio',
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeSlug(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function buildLabelFromId(providerId) {
  const base = normalizeString(providerId)
    .replace(/^custom[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) {
    return 'Custom Provider';
  }
  return base.replace(/\b\w/g, char => char.toUpperCase());
}

export function isCustomProviderId(providerId) {
  return normalizeString(providerId).toLowerCase().startsWith(CUSTOM_PROVIDER_PREFIX);
}

export function normalizeCustomProviderId(rawId, fallbackLabel = '') {
  const normalizedId = normalizeSlug(rawId);
  const normalizedLabel = normalizeSlug(fallbackLabel);
  const token = normalizedId || normalizedLabel || 'provider';
  return token.startsWith(CUSTOM_PROVIDER_PREFIX)
    ? token
    : `${CUSTOM_PROVIDER_PREFIX}${token}`;
}

function normalizeCapabilityList(rawCapabilities) {
  const values = Array.isArray(rawCapabilities) ? rawCapabilities : [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const capability = normalizeString(value).toLowerCase();
    if (!capability || seen.has(capability)) {
      continue;
    }
    if (!CUSTOM_PROVIDER_CAPABILITIES.includes(capability)) {
      continue;
    }
    seen.add(capability);
    result.push(capability);
  }
  return result;
}

function normalizeModelList(rawModels) {
  const values = Array.isArray(rawModels) ? rawModels : [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const modelId = normalizeString(value);
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    result.push(modelId);
  }
  return result;
}

function normalizeModelsMap(rawModels) {
  const models = isPlainObject(rawModels) ? rawModels : {};
  return CUSTOM_PROVIDER_MODEL_CAPABILITIES.reduce((accumulator, capability) => {
    accumulator[capability] = normalizeModelList(models[capability]);
    return accumulator;
  }, {});
}

function buildSyntheticCustomProvider(providerId, providerConfig = {}) {
  return {
    id: normalizeCustomProviderId(providerId),
    label: buildLabelFromId(providerId),
    kind: CUSTOM_PROVIDER_KIND,
    enabled: providerConfig.enabled !== false,
    capabilities: [],
    models: normalizeModelsMap(),
  };
}

function hasLegacyOpenAiProviderConfig(providerConfigs = {}) {
  const providerConfig = isPlainObject(providerConfigs?.[LEGACY_OPENAI_PROVIDER_ID])
    ? providerConfigs[LEGACY_OPENAI_PROVIDER_ID]
    : {};
  return ['apiUrl', 'apiKey', 'modelApiKey'].some(fieldName => normalizeString(providerConfig[fieldName]));
}

function buildLegacyOpenAiCustomProvider(providerConfig = {}) {
  return {
    id: LEGACY_OPENAI_CUSTOM_PROVIDER_ID,
    label: LEGACY_OPENAI_CUSTOM_PROVIDER_LABEL,
    kind: CUSTOM_PROVIDER_KIND,
    enabled: providerConfig.enabled !== false,
    capabilities: ['text', 'connection_test'],
    models: normalizeModelsMap(),
  };
}

function mergeLegacyOpenAiProviderConfig(nextConfig = {}) {
  const providerConfigs = isPlainObject(nextConfig.providers) ? nextConfig.providers : {};
  if (!hasLegacyOpenAiProviderConfig(providerConfigs)) {
    return;
  }

  const legacyConfig = isPlainObject(providerConfigs[LEGACY_OPENAI_PROVIDER_ID])
    ? providerConfigs[LEGACY_OPENAI_PROVIDER_ID]
    : {};
  const existingCustomConfig = isPlainObject(providerConfigs[LEGACY_OPENAI_CUSTOM_PROVIDER_ID])
    ? providerConfigs[LEGACY_OPENAI_CUSTOM_PROVIDER_ID]
    : {};
  const hasExistingEnabled = Object.prototype.hasOwnProperty.call(existingCustomConfig, 'enabled');

  providerConfigs[LEGACY_OPENAI_CUSTOM_PROVIDER_ID] = {
    ...existingCustomConfig,
    apiUrl: normalizeString(existingCustomConfig.apiUrl) || normalizeString(legacyConfig.apiUrl),
    apiKey: normalizeString(existingCustomConfig.apiKey) || normalizeString(legacyConfig.apiKey),
    modelApiKey:
      normalizeString(existingCustomConfig.modelApiKey) || normalizeString(legacyConfig.modelApiKey),
    enabled: hasExistingEnabled ? existingCustomConfig.enabled !== false : legacyConfig.enabled !== false,
  };
}

export function normalizeCustomProviderRecord(rawProvider, { fallbackId = '' } = {}) {
  const source = isPlainObject(rawProvider) ? rawProvider : {};
  const id = normalizeCustomProviderId(source.id || fallbackId, source.label);
  return {
    id,
    label: normalizeString(source.label) || buildLabelFromId(id),
    kind: CUSTOM_PROVIDER_KIND,
    enabled: source.enabled !== false,
    capabilities: normalizeCapabilityList(source.capabilities),
    models: normalizeModelsMap(source.models),
  };
}

export function normalizeCustomProvidersRegistry(rawRegistry, providerConfigs = {}) {
  const entries = Array.isArray(rawRegistry)
    ? rawRegistry
    : isPlainObject(rawRegistry)
      ? Object.entries(rawRegistry).map(([id, value]) => ({
          ...(isPlainObject(value) ? value : {}),
          id: value?.id || id,
        }))
      : [];

  const normalizedProviders = [];
  const seenIds = new Set();

  for (const entry of entries) {
    const normalized = normalizeCustomProviderRecord(entry);
    if (!normalized.id || seenIds.has(normalized.id)) {
      continue;
    }
    seenIds.add(normalized.id);
    normalizedProviders.push(normalized);
  }

  if (hasLegacyOpenAiProviderConfig(providerConfigs) && !seenIds.has(LEGACY_OPENAI_CUSTOM_PROVIDER_ID)) {
    seenIds.add(LEGACY_OPENAI_CUSTOM_PROVIDER_ID);
    normalizedProviders.push(buildLegacyOpenAiCustomProvider(providerConfigs[LEGACY_OPENAI_PROVIDER_ID]));
  }

  if (isPlainObject(providerConfigs)) {
    for (const [providerId, providerConfig] of Object.entries(providerConfigs)) {
      if (!isCustomProviderId(providerId)) {
        continue;
      }
      const normalizedId = normalizeCustomProviderId(providerId);
      if (seenIds.has(normalizedId)) {
        continue;
      }
      seenIds.add(normalizedId);
      normalizedProviders.push(buildSyntheticCustomProvider(normalizedId, providerConfig));
    }
  }

  return normalizedProviders;
}

export function getCustomProviders(config = {}) {
  return normalizeCustomProvidersRegistry(config.customProviders, config.providers);
}

export function getCustomProvider(config = {}, providerId = '') {
  const normalizedId = normalizeCustomProviderId(providerId);
  return getCustomProviders(config).find(provider => provider.id === normalizedId) || null;
}

export function getCustomProviderIds(config = {}) {
  return getCustomProviders(config).map(provider => provider.id);
}

export function normalizeCustomProviderConfig(config = {}) {
  const nextConfig = isPlainObject(config) ? cloneJson(config) : {};
  nextConfig.providers = isPlainObject(nextConfig.providers) ? nextConfig.providers : {};
  mergeLegacyOpenAiProviderConfig(nextConfig);
  nextConfig.customProviders = getCustomProviders(nextConfig);
  return nextConfig;
}

export {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_KIND,
  CUSTOM_PROVIDER_MODEL_CAPABILITIES,
  CUSTOM_PROVIDER_PREFIX,
};