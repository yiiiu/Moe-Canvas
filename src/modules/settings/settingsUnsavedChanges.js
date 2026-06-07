const API_PANE_SELECTOR = '#pane-api-input';
const UNSAVED_HINT_ID = 'settingsUnsavedHint';
const CUSTOM_PROVIDERS_LIST_SELECTOR = '#customProvidersList';
const DIRTY_TOAST_MESSAGE = '有未保存更改';
const DISCARD_CONFIRM_MESSAGE = '有未保存更改，是否关闭设置？';

let isDirty = false;
let installed = false;
let baselineSnapshot = null;
let baselineCaptureTimer = null;
let baselineObserver = null;
let isRestoringBaseline = false;

function getApiPane() {
  return document.querySelector(API_PANE_SELECTOR);
}

function getSaveRow() {
  return document.querySelector(`${API_PANE_SELECTOR} .settings-save-row`);
}

function ensureUnsavedHint() {
  let hint = document.getElementById(UNSAVED_HINT_ID);
  if (hint) {
    return hint;
  }

  const saveRow = getSaveRow();
  if (!saveRow) {
    return null;
  }

  hint = document.createElement('div');
  hint.id = UNSAVED_HINT_ID;
  hint.className = 'settings-unsaved-hint';
  hint.textContent = DIRTY_TOAST_MESSAGE;
  hint.hidden = true;
  saveRow.prepend(hint);
  return hint;
}

function updateUnsavedHint() {
  const hint = ensureUnsavedHint();
  if (hint) {
    hint.hidden = !isDirty;
  }
}

function isApiSettingsTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  const pane = getApiPane();
  return !!pane && pane.contains(target);
}

function getControlKey(control, index) {
  if (control.id) {
    return `id:${control.id}`;
  }
  const providerId = control.dataset?.customProviderId || control.closest?.('[data-custom-provider-card]')?.dataset?.customProviderCard;
  if (providerId && control.dataset?.customProviderField) {
    return `custom-provider-field:${providerId}:${control.dataset.customProviderField}`;
  }
  if (providerId && control.dataset?.customProviderModel) {
    return `custom-provider-model:${providerId}:${control.dataset.customProviderModel}`;
  }
  if (providerId && control.dataset?.customProviderCapability) {
    return `custom-provider-capability:${providerId}:${control.value}`;
  }
  return `index:${index}`;
}

function getControlState(control) {
  if (control.type === 'checkbox' || control.type === 'radio') {
    return { checked: !!control.checked };
  }
  return { value: control.value ?? '' };
}

function applyControlState(control, state) {
  if (!state) {
    return;
  }
  if (control.type === 'checkbox' || control.type === 'radio') {
    control.checked = !!state.checked;
    return;
  }
  control.value = state.value ?? '';
}

function captureSettingsBaseline() {
  const pane = getApiPane();
  if (!pane) {
    return;
  }
  const controls = Array.from(pane.querySelectorAll('input, textarea, select')).map((control, index) => ({
    key: getControlKey(control, index),
    state: getControlState(control),
  }));
  baselineSnapshot = {
    customProvidersListHtml: document.querySelector(CUSTOM_PROVIDERS_LIST_SELECTOR)?.innerHTML ?? null,
    controls,
  };
}

function restoreSettingsBaseline() {
  if (!baselineSnapshot) {
    return;
  }
  const providerList = document.querySelector(CUSTOM_PROVIDERS_LIST_SELECTOR);
  if (providerList && baselineSnapshot.customProvidersListHtml !== null) {
    providerList.innerHTML = baselineSnapshot.customProvidersListHtml;
  }
  const pane = getApiPane();
  if (!pane) {
    return;
  }
  const states = new Map(baselineSnapshot.controls.map(item => [item.key, item.state]));
  Array.from(pane.querySelectorAll('input, textarea, select')).forEach((control, index) => {
    applyControlState(control, states.get(getControlKey(control, index)));
  });
}

function scheduleBaselineCapture() {
  if (baselineCaptureTimer) {
    clearTimeout(baselineCaptureTimer);
  }
  baselineCaptureTimer = setTimeout(() => {
    baselineCaptureTimer = null;
    if (!isDirty && !isRestoringBaseline) {
      captureSettingsBaseline();
    }
  }, 0);
}

export function hasSettingsUnsavedChanges() {
  return isDirty;
}

export function markSettingsUnsavedChanges({ silent = false } = {}) {
  const wasDirty = isDirty;
  isDirty = true;
  updateUnsavedHint();
  if (!wasDirty && !silent) {
    window.showToast?.(DIRTY_TOAST_MESSAGE, 'info');
  }
}

export function clearSettingsUnsavedChanges() {
  isDirty = false;
  updateUnsavedHint();
  scheduleBaselineCapture();
}

export function requestSettingsPanelClose() {
  if (!isDirty) {
    return true;
  }
  return window.confirm?.(DISCARD_CONFIRM_MESSAGE) ?? true;
}

function handleApiPaneMutation(event) {
  if (isRestoringBaseline) {
    return;
  }
  if (!isApiSettingsTarget(event.target)) {
    return;
  }
  markSettingsUnsavedChanges();
}

export function installSettingsUnsavedChangeGuard() {
  if (installed || typeof document === 'undefined') {
    return;
  }
  installed = true;
  document.addEventListener('input', handleApiPaneMutation, true);
  document.addEventListener('change', handleApiPaneMutation, true);
  if (typeof MutationObserver !== 'undefined') {
    baselineObserver = new MutationObserver(() => {
      if (!isDirty && !isRestoringBaseline) {
        scheduleBaselineCapture();
      }
    });
    baselineObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      updateUnsavedHint();
      scheduleBaselineCapture();
    }, { once: true });
  } else {
    updateUnsavedHint();
    scheduleBaselineCapture();
  }
}

if (typeof window !== 'undefined') {
  window.clearSettingsUnsavedChanges = clearSettingsUnsavedChanges;
  window.markSettingsUnsavedChanges = markSettingsUnsavedChanges;
  window.hasSettingsUnsavedChanges = hasSettingsUnsavedChanges;
  installSettingsUnsavedChangeGuard();
}