import { fetchUserSettingsFromServer, saveUserSettingsToServer } from '../../api/userSettingsApi.js';

const AUTO_SAVE_SETTING_KEY = 'autoSaveEnabled';
const AUTO_SAVE_STORAGE_KEY = 'aicanvas.autoSaveEnabled';
const AUTO_SAVE_WINDOW_KEY = '__aicAutoSaveEnabled';

function normalizeAutoSaveEnabled(value) {
  return value !== false;
}

function readStoredAutoSaveEnabled() {
  try {
    const value = globalThis.localStorage?.getItem(AUTO_SAVE_STORAGE_KEY);
    if (value === '0') return false;
    if (value === '1') return true;
  } catch {}
  return true;
}

export function isAutoSaveEnabled() {
  if (typeof globalThis[AUTO_SAVE_WINDOW_KEY] === 'boolean') {
    return globalThis[AUTO_SAVE_WINDOW_KEY];
  }
  return readStoredAutoSaveEnabled();
}

export function applyAutoSaveEnabled(enabled) {
  const normalized = normalizeAutoSaveEnabled(enabled);
  globalThis[AUTO_SAVE_WINDOW_KEY] = normalized;
  try {
    globalThis.localStorage?.setItem(AUTO_SAVE_STORAGE_KEY, normalized ? '1' : '0');
  } catch {}
  try {
    globalThis.dispatchEvent?.(
      new CustomEvent('aicanvas:auto-save-enabled-changed', {
        detail: { enabled: normalized },
      }),
    );
  } catch {}
  return normalized;
}

export function resolveAutoSaveEnabledFromSettings(settings = {}) {
  return normalizeAutoSaveEnabled(settings?.[AUTO_SAVE_SETTING_KEY]);
}

export async function syncAutoSavePreferenceFromServer() {
  const settings = await fetchUserSettingsFromServer();
  return applyAutoSaveEnabled(resolveAutoSaveEnabledFromSettings(settings));
}

export async function saveAutoSavePreferenceToServer(enabled) {
  const normalized = normalizeAutoSaveEnabled(enabled);
  const current = await fetchUserSettingsFromServer().catch(() => ({}));
  const nextSettings = {
    ...(current || {}),
    [AUTO_SAVE_SETTING_KEY]: normalized,
    autoSaveMeta: {
      ...(current?.autoSaveMeta || {}),
      updatedAt: Date.now(),
    },
  };
  const response = await saveUserSettingsToServer(nextSettings);
  const savedSettings = response?.settings || nextSettings;
  return applyAutoSaveEnabled(resolveAutoSaveEnabledFromSettings(savedSettings));
}

export function installAutoSavePersistenceGuard(cache = globalThis.V2LocalCache) {
  if (!cache || typeof cache.save !== 'function' || cache.__autoSavePersistenceGuardInstalled) return;
  const originalSave = cache.save.bind(cache);
  cache.save = async (...args) => {
    if (!isAutoSaveEnabled()) {
      return { success: false, reason: 'auto-save-disabled' };
    }
    return originalSave(...args);
  };
  cache.__autoSavePersistenceGuardInstalled = true;
}