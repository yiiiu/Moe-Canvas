import { fetchUserSettingsFromServer, saveUserSettingsToServer } from '../../../api/userSettingsApi.js';
import { showError, showSuccess } from '../../services/toastService.js';

const DEFAULT_CUSTOM_STORAGE = Object.freeze({
  enabled: false,
  activeBucketId: '',
  buckets: [],
});

const FIELD_IDS = Object.freeze({
  enabled: 'customStorageEnabled',
  label: 'customStorageLabel',
  endpoint: 'customStorageEndpoint',
  region: 'customStorageRegion',
  bucket: 'customStorageBucket',
  accessKeyId: 'customStorageAccessKeyId',
  secretAccessKey: 'customStorageSecretAccessKey',
  forcePathStyle: 'customStorageForcePathStyle',
  publicBaseUrl: 'customStoragePublicBaseUrl',
  prefix: 'customStoragePrefix',
  saveButton: 'btnCustomStorageSave',
  testButton: 'btnCustomStorageTest',
  status: 'customStorageStatus',
  secretToggles: [
    ['customStorageAccessKeyId', 'customStorageAccessKeyIdToggle'],
    ['customStorageSecretAccessKey', 'customStorageSecretAccessKeyToggle'],
  ],
});

function text(value) {
  return String(value ?? '').trim();
}

function trimTrailingSlash(value) {
  return text(value).replace(/\/+$/g, '');
}

function normalizePrefix(value) {
  const cleaned = text(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  if (!cleaned) {
    return '';
  }
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`;
}

function normalizeBucket(rawBucket = {}, index = 0) {
  const id = text(rawBucket.id) || `bucket_${index + 1}`;
  return {
    id,
    label: text(rawBucket.label) || '自定义存储桶',
    providerType: 's3-compatible',
    endpoint: trimTrailingSlash(rawBucket.endpoint),
    region: text(rawBucket.region) || 'auto',
    bucket: text(rawBucket.bucket),
    accessKeyId: text(rawBucket.accessKeyId),
    secretAccessKey: text(rawBucket.secretAccessKey),
    forcePathStyle: !!rawBucket.forcePathStyle,
    publicBaseUrl: trimTrailingSlash(rawBucket.publicBaseUrl),
    prefix: normalizePrefix(rawBucket.prefix),
    enabled: rawBucket.enabled !== false,
  };
}

export function normalizeCustomStorageSettings(settings = {}) {
  const source = settings?.customStorage && !Array.isArray(settings.customStorage)
    ? settings.customStorage
    : settings;
  const buckets = Array.isArray(source?.buckets)
    ? source.buckets.map(normalizeBucket).filter(bucket => bucket.endpoint || bucket.bucket || bucket.accessKeyId || bucket.secretAccessKey)
    : [];
  const activeBucketId = text(source?.activeBucketId) || buckets.find(bucket => bucket.enabled)?.id || '';
  return {
    enabled: !!source?.enabled && buckets.length > 0,
    activeBucketId,
    buckets,
  };
}

export function buildCustomStorageSettings(existingSettings = {}, customStorage = {}) {
  return {
    ...(existingSettings || {}),
    customStorage: normalizeCustomStorageSettings(customStorage),
  };
}

export function sanitizeStorageErrorMessage(error, bucket = {}) {
  const candidates = [
    bucket?.accessKeyId,
    bucket?.secretAccessKey,
  ].map(text).filter(Boolean);
  const original = error instanceof Error ? error.message : text(error);
  return candidates.reduce((message, secret) => message.split(secret).join('***'), original || '存储桶操作失败');
}

function getElement(id) {
  return document.getElementById(id);
}

const SECRET_TOGGLE_ICON_SHOW = `
  <svg class="settings-secret-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path>
    <circle cx="12" cy="12" r="2.8"></circle>
  </svg>`;

const SECRET_TOGGLE_ICON_HIDE = `
  <svg class="settings-secret-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M2.5 12s3.5-6 9.5-6c1.6 0 3 .4 4.2 1"></path>
    <path d="M21.5 12s-3.5 6-9.5 6c-1.6 0-3-.4-4.2-1"></path>
    <path d="M3 3l18 18"></path>
    <path d="M9.9 9.9A2.8 2.8 0 0 0 14.1 14.1"></path>
  </svg>`;

function renderSecretToggleIcon(toggle, visible) {
  toggle.textContent = '';
  toggle.innerHTML = visible ? SECRET_TOGGLE_ICON_HIDE : SECRET_TOGGLE_ICON_SHOW;
}

export function bindSecretVisibilityToggles() {
  FIELD_IDS.secretToggles.forEach(([inputId, toggleId]) => {
    const input = getElement(inputId);
    const toggle = getElement(toggleId);
    if (!input || !toggle || toggle.__customStorageSecretToggleBound) {
      return;
    }
    const syncToggle = () => {
      const visible = input.type === 'text';
      const label = visible ? '隐藏密钥' : '显示密钥';
      renderSecretToggleIcon(toggle, visible);
      toggle.title = label;
      toggle.setAttribute?.('aria-label', label);
      toggle.setAttribute?.('aria-pressed', visible ? 'true' : 'false');
    };
    toggle.__customStorageSecretToggleBound = true;
    toggle.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      syncToggle();
    });
    syncToggle();
  });
}

function setValue(id, value) {
  const element = getElement(id);
  if (element) {
    element.value = value ?? '';
  }
}

function setChecked(id, value) {
  const element = getElement(id);
  if (element) {
    element.checked = !!value;
  }
}

function readChecked(id) {
  return !!getElement(id)?.checked;
}

function readValue(id) {
  return text(getElement(id)?.value);
}

function getPrimaryBucket(customStorage) {
  return customStorage.buckets.find(bucket => bucket.id === customStorage.activeBucketId) || customStorage.buckets[0] || null;
}

function applyCustomStorageToForm(settings = {}) {
  const customStorage = normalizeCustomStorageSettings(settings);
  const bucket = getPrimaryBucket(customStorage) || normalizeBucket({}, 0);
  setChecked(FIELD_IDS.enabled, customStorage.enabled);
  setValue(FIELD_IDS.label, bucket.label === '自定义存储桶' ? '' : bucket.label);
  setValue(FIELD_IDS.endpoint, bucket.endpoint);
  setValue(FIELD_IDS.region, bucket.region);
  setValue(FIELD_IDS.bucket, bucket.bucket);
  setValue(FIELD_IDS.accessKeyId, bucket.accessKeyId);
  setValue(FIELD_IDS.secretAccessKey, bucket.secretAccessKey);
  setChecked(FIELD_IDS.forcePathStyle, bucket.forcePathStyle);
  setValue(FIELD_IDS.publicBaseUrl, bucket.publicBaseUrl);
  setValue(FIELD_IDS.prefix, bucket.prefix);
}

function readCustomStorageFromForm() {
  const bucket = normalizeBucket({
    id: 'bucket_default',
    label: readValue(FIELD_IDS.label) || '自定义存储桶',
    endpoint: readValue(FIELD_IDS.endpoint),
    region: readValue(FIELD_IDS.region),
    bucket: readValue(FIELD_IDS.bucket),
    accessKeyId: readValue(FIELD_IDS.accessKeyId),
    secretAccessKey: readValue(FIELD_IDS.secretAccessKey),
    forcePathStyle: readChecked(FIELD_IDS.forcePathStyle),
    publicBaseUrl: readValue(FIELD_IDS.publicBaseUrl),
    prefix: readValue(FIELD_IDS.prefix),
    enabled: true,
  });
  const hasBucketConfig = bucket.endpoint || bucket.bucket || bucket.accessKeyId || bucket.secretAccessKey;
  return normalizeCustomStorageSettings({
    enabled: readChecked(FIELD_IDS.enabled) && hasBucketConfig,
    activeBucketId: hasBucketConfig ? bucket.id : '',
    buckets: hasBucketConfig ? [bucket] : [],
  });
}

function validateCustomStorage(customStorage) {
  if (!customStorage.enabled) {
    return '';
  }
  const bucket = getPrimaryBucket(customStorage);
  if (!bucket?.endpoint) return '请输入 S3 Endpoint';
  if (!bucket.bucket) return '请输入 Bucket 名称';
  if (!bucket.accessKeyId) return '请输入 Access Key ID';
  if (!bucket.secretAccessKey) return '请输入 Secret Access Key';
  return '';
}

function setBusy(button, busy, busyText, idleText) {
  if (!button) return;
  button.disabled = !!busy;
  button.textContent = busy ? busyText : idleText;
}

function setStatus(message, tone = '') {
  const status = getElement(FIELD_IDS.status);
  if (!status) return;
  status.textContent = message || '';
  status.dataset.status = tone;
}

async function saveCustomStorage() {
  const saveButton = getElement(FIELD_IDS.saveButton);
  const customStorage = readCustomStorageFromForm();
  const validationError = validateCustomStorage(customStorage);
  if (validationError) {
    showError(validationError);
    setStatus(validationError, 'error');
    return;
  }
  setBusy(saveButton, true, '保存中...', '保存存储桶');
  try {
    const existingSettings = await fetchUserSettingsFromServer().catch(() => ({}));
    const nextSettings = buildCustomStorageSettings(existingSettings, customStorage);
    await saveUserSettingsToServer(nextSettings);
    applyCustomStorageToForm(nextSettings.customStorage);
    setStatus(customStorage.enabled ? '自定义存储桶已启用' : '自定义存储桶已关闭', 'success');
    showSuccess('存储桶配置已保存');
  } catch (error) {
    const bucket = getPrimaryBucket(customStorage);
    const message = sanitizeStorageErrorMessage(error, bucket);
    console.error('[Settings] 保存自定义存储桶失败:', message);
    setStatus(message, 'error');
    showError(`保存存储桶失败：${message}`);
  } finally {
    setBusy(saveButton, false, '保存中...', '保存存储桶');
  }
}

export async function __testCustomStorageConnection(bucket) {
  const response = await fetch('/api/v2/storage/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bucket || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || '连接测试失败');
  }
  return payload;
}

async function testCustomStorage() {
  const testButton = getElement(FIELD_IDS.testButton);
  const customStorage = readCustomStorageFromForm();
  const validationError = validateCustomStorage(customStorage);
  if (validationError) {
    showError(validationError);
    setStatus(validationError, 'error');
    return;
  }
  setBusy(testButton, true, '测试中...', '测试连接');
  try {
    const bucket = getPrimaryBucket(customStorage);
    await __testCustomStorageConnection(bucket);
    setStatus('存储桶连接测试通过', 'success');
    showSuccess('存储桶连接测试通过');
  } catch (error) {
    const bucket = getPrimaryBucket(customStorage);
    const message = sanitizeStorageErrorMessage(error, bucket);
    setStatus(message, 'error');
    showError(`测试连接失败：${message}`);
  } finally {
    setBusy(testButton, false, '测试中...', '测试连接');
  }
}

export const __testCustomStorage = testCustomStorage;

export function initCustomStorageSettings() {
  const saveButton = getElement(FIELD_IDS.saveButton);
  if (!saveButton || saveButton.__customStorageBound) {
    return;
  }
  const testButton = getElement(FIELD_IDS.testButton);
  saveButton.__customStorageBound = true;
  if (testButton) {
    testButton.__customStorageBound = true;
  }
  bindSecretVisibilityToggles();
  fetchUserSettingsFromServer()
    .then(settings => applyCustomStorageToForm(settings?.customStorage || {}))
    .catch(error => {
      const message = sanitizeStorageErrorMessage(error);
      console.error('[Settings] 加载自定义存储桶失败:', message);
      setStatus('加载存储桶配置失败', 'error');
    });
  saveButton.addEventListener('click', () => {
    void saveCustomStorage();
  });
  testButton?.addEventListener('click', () => {
    void testCustomStorage();
  });
}