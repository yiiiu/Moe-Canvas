const STORAGE_KEY = 'moe.canvasControlsPlacement';
const DEFAULT_PLACEMENT = 'bottom-left';
const PLACEMENTS = new Set(['bottom-left', 'top-right']);
const ROOT_ATTRIBUTE = 'data-canvas-controls-placement';
const BUTTON_SELECTOR = '[data-canvas-controls-placement-option]';

function normalizePlacement(value) {
  const placement = String(value || '').trim();
  return PLACEMENTS.has(placement) ? placement : DEFAULT_PLACEMENT;
}

export function readCanvasControlsPlacement() {
  try {
    return normalizePlacement(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_PLACEMENT;
  }
}

function persistCanvasControlsPlacement(placement) {
  try {
    localStorage.setItem(STORAGE_KEY, placement);
  } catch {}
}

function syncButtons(placement) {
  document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
    const isActive = normalizePlacement(button.dataset.canvasControlsPlacementOption) === placement;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

export function applyCanvasControlsPlacement(value, options = {}) {
  const placement = normalizePlacement(value);
  document.documentElement.setAttribute(ROOT_ATTRIBUTE, placement);
  syncButtons(placement);
  if (options.persist !== false) {
    persistCanvasControlsPlacement(placement);
  }
  window.dispatchEvent(
    new CustomEvent('moe-canvas-controls-placement-changed', {
      detail: { placement },
    }),
  );
  return placement;
}

export function applyCanvasControlsPlacementFromStorage() {
  return applyCanvasControlsPlacement(readCanvasControlsPlacement(), { persist: false });
}

export function initCanvasControlsPlacementSettings() {
  const buttons = Array.from(document.querySelectorAll(BUTTON_SELECTOR));
  if (buttons.length === 0) {
    applyCanvasControlsPlacementFromStorage();
    return;
  }

  applyCanvasControlsPlacementFromStorage();
  buttons.forEach((button) => {
    if (button.__canvasControlsPlacementBound) return;
    button.__canvasControlsPlacementBound = true;
    button.addEventListener('click', () => {
      applyCanvasControlsPlacement(button.dataset.canvasControlsPlacementOption);
    });
  });
}