import {
  installAutoSavePersistenceGuard,
  isAutoSaveEnabled,
  saveAutoSavePreferenceToServer,
  syncAutoSavePreferenceFromServer,
} from '../../services/autoSavePreferenceService.js';
import { showError, showSuccess } from '../../services/toastService.js';

const GROUP_ID = 'autoSaveGroup';
const ON_BUTTON_ID = 'btnAutoSaveOn';
const OFF_BUTTON_ID = 'btnAutoSaveOff';

function setButtonState(enabled) {
  const onButton = document.getElementById(ON_BUTTON_ID);
  const offButton = document.getElementById(OFF_BUTTON_ID);
  onButton?.classList.toggle('active', enabled);
  offButton?.classList.toggle('active', !enabled);
}

function setBusy(busy) {
  const group = document.getElementById(GROUP_ID);
  if (!group) return;
  group.querySelectorAll('button').forEach((button) => {
    button.disabled = Boolean(busy);
  });
}

async function saveAutoSaveEnabled(enabled) {
  setBusy(true);
  setButtonState(enabled);
  try {
    const savedEnabled = await saveAutoSavePreferenceToServer(enabled);
    setButtonState(savedEnabled);
    if (savedEnabled && typeof globalThis._triggerLocalCacheSave === 'function') {
      globalThis._triggerLocalCacheSave();
    }
    showSuccess(savedEnabled ? '已开启自动保存' : '已关闭自动保存');
  } catch (error) {
    setButtonState(isAutoSaveEnabled());
    showError(`保存自动保存设置失败：${error?.message || '未知错误'}`);
  } finally {
    setBusy(false);
  }
}

export function initAutoSaveSettings() {
  const group = document.getElementById(GROUP_ID);
  if (!group || group.__autoSaveSettingsBound) return;
  group.__autoSaveSettingsBound = true;
  installAutoSavePersistenceGuard();

  setButtonState(isAutoSaveEnabled());
  syncAutoSavePreferenceFromServer()
    .then((enabled) => setButtonState(enabled))
    .catch(() => setButtonState(isAutoSaveEnabled()));

  document.getElementById(ON_BUTTON_ID)?.addEventListener('click', () => {
    void saveAutoSaveEnabled(true);
  });
  document.getElementById(OFF_BUTTON_ID)?.addEventListener('click', () => {
    void saveAutoSaveEnabled(false);
  });
}