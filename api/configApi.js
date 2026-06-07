import { PROVIDERS_META } from '../src/modules/providers.js';
import {
  clearCustomProviderRuntimeManifests,
  setCustomProviderRuntimeManifests,
} from '../src/manifests/index.js';
import { get, post } from './apiBase.js';
import {
  getCustomProvider,
  getCustomProviderIds,
  getCustomProviders,
  normalizeCustomProviderConfig,
} from './customProviderRegistry.js';

let apiConfig = null;

const SECURE_PROVIDER_FIELDS = ['apiKey', 'modelApiKey'];
const LEGACY_GRSAI_KEY_FIELDS = ['apiKey', 'apiKeyInput'];
const REMOVED_PROVIDER_IDS = Object.freeze(['ppio']);
const DEFAULT_SECURE_PROVIDER_IDS = Object.freeze(
  [
    ...new Set([
      ...Object.keys(PROVIDERS_META || {}),
      'grsai',
      'openai',
      'apimart',
      'runninghub',
      'runninghubwf',
    ]),
  ],
);

export function clearApiConfig() {
  apiConfig = null;
  clearCustomProviderRuntimeManifests();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig(value) {
  return isPlainObject(value) ? JSON.parse(JSON.stringify(value)) : {};
}

function normalizeProviderId(providerId) {
  return String(providerId || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
}

function normalizeApiConfig(config = {}) {
  const normalizedConfig = normalizeCustomProviderConfig(cloneConfig(config));
  if (isPlainObject(normalizedConfig.providers)) {
    for (const providerId of REMOVED_PROVIDER_IDS) {
      delete normalizedConfig.providers[providerId];
    }
  }
  return normalizedConfig;
}

function buildProviderSecureKey(providerId, fieldName) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedFieldName = String(fieldName || '').trim();
  if (!normalizedProviderId || !SECURE_PROVIDER_FIELDS.includes(normalizedFieldName)) {
    return '';
  }
  return `apiConfig.providers.${normalizedProviderId}.${normalizedFieldName}`;
}

function getSecureSettingsApi() {
  const secureSettings = globalThis?.window?.electronAPI?.secureSettings;
  if (
    secureSettings &&
    typeof secureSettings.get === 'function' &&
    typeof secureSettings.set === 'function' &&
    typeof secureSettings.delete === 'function'
  ) {
    return secureSettings;
  }
  return null;
}

function collectProviderIds(config = {}) {
  const normalizedConfig = normalizeApiConfig(config);
  const providerIds = new Set(DEFAULT_SECURE_PROVIDER_IDS);

  if (isPlainObject(normalizedConfig.providers)) {
    for (const providerId of Object.keys(normalizedConfig.providers)) {
      const normalizedProviderId = normalizeProviderId(providerId);
      if (normalizedProviderId) {
        providerIds.add(normalizedProviderId);
      }
    }
  }

  for (const providerId of getCustomProviderIds(normalizedConfig)) {
    const normalizedProviderId = normalizeProviderId(providerId);
    if (normalizedProviderId) {
      providerIds.add(normalizedProviderId);
    }
  }

  return [...providerIds];
}

function collectSecureKeys(config = {}) {
  const keys = [];
  for (const providerId of collectProviderIds(config)) {
    for (const fieldName of SECURE_PROVIDER_FIELDS) {
      const secureKey = buildProviderSecureKey(providerId, fieldName);
      if (secureKey) {
        keys.push(secureKey);
      }
    }
  }
  return keys;
}

function stripSensitiveConfigValues(config = {}) {
  const safeConfig = normalizeApiConfig(config);

  if (isPlainObject(safeConfig.providers)) {
    for (const providerConfig of Object.values(safeConfig.providers)) {
      if (!isPlainObject(providerConfig)) {
        continue;
      }
      for (const fieldName of SECURE_PROVIDER_FIELDS) {
        delete providerConfig[fieldName];
      }
    }
  }

  for (const fieldName of LEGACY_GRSAI_KEY_FIELDS) {
    delete safeConfig[fieldName];
  }

  return safeConfig;
}

function extractPlaintextSecureValues(config = {}) {
  const normalizedConfig = normalizeApiConfig(config);
  const secureValues = new Map();
  const providers = isPlainObject(normalizedConfig.providers) ? normalizedConfig.providers : {};

  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (!isPlainObject(providerConfig)) {
      continue;
    }

    for (const fieldName of SECURE_PROVIDER_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(providerConfig, fieldName)) {
        continue;
      }
      const secureKey = buildProviderSecureKey(providerId, fieldName);
      if (!secureKey) {
        continue;
      }
      secureValues.set(secureKey, String(providerConfig[fieldName] || ''));
    }
  }

  const hasProviderLevelGrsaiKey = !!String(providers?.grsai?.apiKey || '').trim();
  if (!hasProviderLevelGrsaiKey) {
    for (const fieldName of LEGACY_GRSAI_KEY_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(normalizedConfig, fieldName)) {
        continue;
      }
      const legacyValue = String(normalizedConfig[fieldName] || '');
      if (legacyValue) {
        secureValues.set(buildProviderSecureKey('grsai', 'apiKey'), legacyValue);
      }
    }
  }

  return secureValues;
}

function mergeSecureValuesIntoConfig(config = {}, secureValues = {}) {
  const mergedConfig = stripSensitiveConfigValues(config);

  for (const [key, value] of Object.entries(secureValues || {})) {
    const match = String(key || '').match(/^apiConfig\.providers\.([A-Za-z0-9_-]+)\.(apiKey|modelApiKey)$/);
    if (!match) {
      continue;
    }

    const providerId = match[1];
    const fieldName = match[2];
    const normalizedValue = String(value || '');
    if (!normalizedValue) {
      continue;
    }

    if (!isPlainObject(mergedConfig.providers)) {
      mergedConfig.providers = {};
    }
    if (!isPlainObject(mergedConfig.providers[providerId])) {
      mergedConfig.providers[providerId] = {};
    }
    mergedConfig.providers[providerId][fieldName] = normalizedValue;
  }

  return normalizeApiConfig(mergedConfig);
}

async function readSecureValues(config = {}) {
  const secureSettings = getSecureSettingsApi();
  if (!secureSettings) {
    return { available: false, values: {} };
  }

  try {
    const result = await secureSettings.get({ keys: collectSecureKeys(config) });
    if (!result?.available) {
      return { available: false, values: {} };
    }
    return {
      available: true,
      values: isPlainObject(result.values) ? result.values : {},
    };
  } catch {
    return { available: false, values: {} };
  }
}

function collectRemovedProviderSecureKeys() {
  const keys = [];
  for (const providerId of REMOVED_PROVIDER_IDS) {
    for (const fieldName of SECURE_PROVIDER_FIELDS) {
      const secureKey = buildProviderSecureKey(providerId, fieldName);
      if (secureKey) {
        keys.push(secureKey);
      }
    }
  }
  return keys;
}

async function deleteRemovedProviderSecureValues() {
  const secureSettings = getSecureSettingsApi();
  if (!secureSettings) {
    return { available: false, changed: false };
  }

  const availability = await secureSettings.get({ keys: [] }).catch(() => null);
  if (!availability?.available) {
    return { available: false, changed: false };
  }

  let changed = false;
  for (const key of collectRemovedProviderSecureKeys()) {
    const result = await secureSettings.delete({ key });
    if (result?.ok) {
      changed = true;
    }
  }
  return { available: true, changed };
}

async function writeSecureValues(secureValues) {
  const secureSettings = getSecureSettingsApi();
  if (!secureSettings || !(secureValues instanceof Map)) {
    return { available: false, changed: false };
  }

  const availability = await secureSettings.get({ keys: [] }).catch(() => null);
  if (!availability?.available) {
    return { available: false, changed: false };
  }

  let changed = false;
  for (const [key, value] of secureValues.entries()) {
    if (!key) {
      continue;
    }

    const normalizedValue = String(value || '');
    if (normalizedValue) {
      const result = await secureSettings.set({ key, value: normalizedValue });
      if (result?.ok) {
        changed = true;
      }
      continue;
    }

    const result = await secureSettings.delete({ key });
    if (result?.ok) {
      changed = true;
    }
  }

  return { available: true, changed };
}

async function hydrateConfigFromSecureStorage(config = {}) {
  const normalizedConfig = normalizeApiConfig(config);
  const plaintextSecureValues = extractPlaintextSecureValues(normalizedConfig);
  const { available, values } = await readSecureValues(normalizedConfig);
  await deleteRemovedProviderSecureValues();

  if (!available) {
    return normalizedConfig;
  }

  let mergedSecureValues = { ...values };
  if (plaintextSecureValues.size > 0) {
    const writeResult = await writeSecureValues(plaintextSecureValues);
    if (writeResult.available) {
      plaintextSecureValues.forEach((value, key) => {
        if (String(value || '')) {
          mergedSecureValues[key] = String(value || '');
        } else {
          delete mergedSecureValues[key];
        }
      });
      await post('/api/config', stripSensitiveConfigValues(normalizedConfig)).catch(() => null);
    }
  }

  return mergeSecureValuesIntoConfig(normalizedConfig, mergedSecureValues);
}

function syncRuntimeCustomProviderRegistry(config) {
  const customProviders = getCustomProviders(config || {});
  if (customProviders.length === 0) {
    clearCustomProviderRuntimeManifests();
    return;
  }
  setCustomProviderRuntimeManifests(customProviders);
}

function syncLegacyWindowApiKeys(config) {  if (typeof window === 'undefined') {
    return;
  }

  const providers = config?.providers || {};
  const legacyGrsaiKey = config?.apiKey || '';
  window._appApiKey = providers.grsai?.apiKey || legacyGrsaiKey || '';
  window._runningHubApiKey = providers.runninghub?.apiKey || '';
  window._runningHubModelApiKey = providers.runninghub?.modelApiKey || '';
}

export async function fetchApiConfigFromServer() {
  const response = await get('/api/config');
  if (!response.success) {
    throw new Error(response.error || '获取配置失败');
  }

  apiConfig = await hydrateConfigFromSecureStorage(response.data || {});
  apiConfig = normalizeApiConfig(apiConfig);
  syncRuntimeCustomProviderRegistry(apiConfig);
  syncLegacyWindowApiKeys(apiConfig);
  return apiConfig;
}

export async function saveApiConfigToServer(config) {
  const normalizedConfig = normalizeApiConfig(config || {});
  const plaintextSecureValues = extractPlaintextSecureValues(normalizedConfig);
  const secureWriteResult = await writeSecureValues(plaintextSecureValues);
  await deleteRemovedProviderSecureValues();
  const payload = secureWriteResult.available
    ? stripSensitiveConfigValues(normalizedConfig)
    : normalizedConfig;

  const response = await post('/api/config', payload);
  if (!response.success) {
    throw new Error(response.error || '保存配置失败');
  }

  apiConfig = normalizedConfig;
  syncRuntimeCustomProviderRegistry(normalizedConfig);
  syncLegacyWindowApiKeys(normalizedConfig);
  return response.data;
}

export async function ensureConfig() {
  if (apiConfig) {
    return;
  }
  await fetchApiConfigFromServer();
}

export function getApiConfig() {
  return apiConfig ? cloneConfig(apiConfig) : null;
}

export function getCustomProvidersConfig() {
  return apiConfig ? getCustomProviders(apiConfig) : [];
}

export function getCustomProviderMeta(providerId) {
  return apiConfig ? getCustomProvider(apiConfig, providerId) : null;
}

export function getProviderConfig(providerId) {
  const normalizedProviderId = normalizeProviderId(providerId);
  const providerMeta = PROVIDERS_META[normalizedProviderId];
  const defaultUrl = providerMeta?.defaultUrl || '';
  const providerConfig = apiConfig?.providers?.[normalizedProviderId];

  if (providerConfig?.apiUrl || providerConfig?.apiKey || providerConfig?.modelApiKey) {
    return {
      apiUrl: (providerConfig.apiUrl || defaultUrl).replace(/\/+$/, ''),
      apiKey: providerConfig.apiKey || '',
      modelApiKey: providerConfig.modelApiKey || '',
    };
  }

  if (normalizedProviderId === 'runninghubwf') {
    const runninghubConfig = apiConfig?.providers?.runninghub;
    if (
      runninghubConfig?.apiUrl ||
      runninghubConfig?.apiKey ||
      runninghubConfig?.modelApiKey
    ) {
      return {
        apiUrl: (runninghubConfig.apiUrl || defaultUrl).replace(/\/+$/, ''),
        apiKey: runninghubConfig.apiKey || '',
        modelApiKey: '',
      };
    }
  }

  if (normalizedProviderId === 'grsai') {
    return {
      apiUrl: (apiConfig?.apiUrlInput || apiConfig?.apiUrl || defaultUrl).replace(/\/+$/, ''),
      apiKey: apiConfig?.apiKeyInput || apiConfig?.apiKey || '',
      modelApiKey: '',
    };
  }

  return {
    apiUrl: defaultUrl,
    apiKey: '',
    modelApiKey: '',
  };
}