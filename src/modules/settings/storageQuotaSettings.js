import { fetchUserSettingsFromServer, saveUserSettingsToServer } from '../../../api/userSettingsApi.js';
import { showError, showSuccess } from '../../services/toastService.js';
import { refreshStorageUsageSettings } from './storageUsageSettings.js';

const FIELD_IDS = Object.freeze({
  enabled: 'storageQuotaEnabled',
  limitGB: 'storageQuotaLimitGB',
  warningPercent: 'storageQuotaWarningPercent',
  blockWhenExceeded: 'storageQuotaBlockWhenExceeded',
  saveButton: 'btnStorageQuotaSave',
  status: 'storageQuotaSettingsStatus',
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function element(id) {
  return document.getElementById(id);
}

function setChecked(id, value) {
  const target = element(id);
  if (target) {
    target.checked = !!value;
  }
}

function readChecked(id) {
  return !!element(id)?.checked;
}

function setValue(id, value) {
  const target = element(id);
  if (target) {
    target.value = value ?? '';
  }
}

function readValue(id) {
  return String(element(id)?.value ?? '').trim();
}

function setStatus(message, tone = '') {
  const target = element(FIELD_IDS.status);
  if (!target) {
    return;
  }
  target.textContent = message || '';
  target.dataset.status = tone;
}

function setBusy(button, busy) {
  if (!button) {
    return;
  }
  button.disabled = !!busy;
  button.textContent = busy ? '保存中...' : '保存配额设置';
}

export function normalizeStorageQuotaSettings(settings = {}) {
  const source = settings?.storageQuota && !Array.isArray(settings.storageQuota)
    ? settings.storageQuota
    : settings;
  const limitBytes = Math.floor(number(source?.limitBytes));
  const warningPercent = clamp(Math.round(number(source?.warningPercent) || 80), 1, 100);
  return {
    enabled: !!source?.enabled,
    limitBytes,
    warningPercent,
    blockWhenExceeded: !!source?.blockWhenExceeded,
  };
}

export function buildStorageQuotaSettings(existingSettings = {}, storageQuota = {}) {
  return {
    ...(existingSettings || {}),
    storageQuota: normalizeStorageQuotaSettings(storageQuota),
  };
}

export function readStorageQuotaSettingsForm() {
  const limitGB = number(readValue(FIELD_IDS.limitGB));
  return normalizeStorageQuotaSettings({
    enabled: readChecked(FIELD_IDS.enabled),
    limitBytes: Math.round(limitGB * 1024 * 1024 * 1024),
    warningPercent: Math.round(number(readValue(FIELD_IDS.warningPercent)) || 80),
    blockWhenExceeded: readChecked(FIELD_IDS.blockWhenExceeded),
  });
}

export function renderStorageQuotaSettingsForm(settings = {}) {
  const quota = normalizeStorageQuotaSettings(settings);
  setChecked(FIELD_IDS.enabled, quota.enabled);
  setChecked(FIELD_IDS.blockWhenExceeded, quota.blockWhenExceeded);
  const limitGB = quota.limitBytes > 0 ? quota.limitBytes / 1024 / 1024 / 1024 : 0;
  const roundedLimit = Math.round(limitGB * 100) / 100;
  setValue(FIELD_IDS.limitGB, roundedLimit ? String(Number.isInteger(roundedLimit) ? roundedLimit.toFixed(0) : roundedLimit) : '');
  setValue(FIELD_IDS.warningPercent, String(quota.warningPercent || 80));
}

function validateStorageQuota(storageQuota) {
  if (!storageQuota.enabled) {
    return '';
  }
  if (!storageQuota.limitBytes || storageQuota.limitBytes <= 0) {
    return '启用配额后请输入配额上限';
  }
  return '';
}

export function formatStorageQuotaExceededMessage(error) {
  const raw = error instanceof Error ? error.message : String(error?.message || error?.error || error || '');
  if (!raw.includes('storage_quota_exceeded') && !raw.includes('存储空间不足')) {
    return raw || '保存失败';
  }
  const cleaned = raw.replace(/^storage_quota_exceeded:\s*/i, '').trim();
  return cleaned || '存储空间不足，无法保存。';
}

export async function __saveStorageQuotaSettings() {
  const saveButton = element(FIELD_IDS.saveButton);
  const storageQuota = readStorageQuotaSettingsForm();
  const validationError = validateStorageQuota(storageQuota);
  if (validationError) {
    setStatus(validationError, 'error');
    showError(validationError);
    return null;
  }
  setBusy(saveButton, true);
  try {
    const existingSettings = await fetchUserSettingsFromServer().catch(() => ({}));
    const nextSettings = buildStorageQuotaSettings(existingSettings, storageQuota);
    await saveUserSettingsToServer(nextSettings);
    renderStorageQuotaSettingsForm(nextSettings.storageQuota);
    setStatus(storageQuota.blockWhenExceeded ? '超额阻断已开启' : '配额设置已保存，超额仅提醒不阻断', 'success');
    showSuccess('配额设置已保存');
    void refreshStorageUsageSettings();
    return nextSettings;
  } catch (error) {
    const message = formatStorageQuotaExceededMessage(error) || '保存配额设置失败';
    setStatus(message, 'error');
    showError(message);
    return null;
  } finally {
    setBusy(saveButton, false);
  }
}

export function initStorageQuotaSettings() {
  const saveButton = element(FIELD_IDS.saveButton);
  if (!saveButton || saveButton.__storageQuotaBound) {
    return;
  }
  saveButton.__storageQuotaBound = true;
  fetchUserSettingsFromServer()
    .then(settings => renderStorageQuotaSettingsForm(settings?.storageQuota || {}))
    .catch(() => setStatus('加载配额设置失败', 'error'));
  saveButton.addEventListener('click', () => {
    void __saveStorageQuotaSettings();
  });
}