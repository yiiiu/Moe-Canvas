const STORAGE_KEY = 'moe.zoomLockEnabled';
const CHANGE_EVENT = 'moe-zoom-lock-changed';

let zoomLockEnabled = readStoredZoomLock();

function readStoredZoomLock() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredZoomLock(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {}
}

function publishZoomLockState() {
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: { enabled: zoomLockEnabled },
    }),
  );
}

export function isZoomLockEnabled() {
  return zoomLockEnabled;
}

export function setZoomLockEnabled(value, options = {}) {
  zoomLockEnabled = Boolean(value);
  if (options.persist !== false) {
    writeStoredZoomLock(zoomLockEnabled);
  }
  publishZoomLockState();
  return zoomLockEnabled;
}

export function toggleZoomLockEnabled() {
  return setZoomLockEnabled(!zoomLockEnabled);
}

export function initZoomLockState() {
  zoomLockEnabled = readStoredZoomLock();
  publishZoomLockState();
  return zoomLockEnabled;
}

export const ZOOM_LOCK_CHANGE_EVENT = CHANGE_EVENT;