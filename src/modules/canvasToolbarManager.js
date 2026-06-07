import { renderIconLibrary } from './ui/iconLibrary.js';

const CANVAS_COLOR_KEY = 'moe.canvasBackgroundColor';
const CANVAS_RECENT_COLORS_KEY = 'moe.canvasBackgroundRecentColors';
const CANVAS_CONTROLS_PLACEMENT_KEY = 'moe.canvasControlsPlacement';
const CANVAS_CONTROLS_PLACEMENT_ATTRIBUTE = 'data-canvas-controls-placement';
const CANVAS_CONTROLS_PLACEMENTS = new Set(['bottom-left', 'top-right']);
const DEFAULT_CANVAS_CONTROLS_PLACEMENT = 'bottom-left';
const DEFAULT_CANVAS_COLOR = '';
const MAX_RECENT_COLORS = 5;

const APP_THEME_KEY = 'v2-app-theme-preset';
const APP_THEME_SEQUENCE = ['dusk', 'dawn', 'day'];
const APP_THEME_LABELS = {
  dusk: '暗夕',
  dawn: 'Moe 紫',
  day: '白昼',
};

function getEl(id) {
  return document.getElementById(id);
}

function normalizeHexColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_CANVAS_COLOR;
}

function readJsonArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonArray(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readCanvasColor() {
  try {
    return normalizeHexColor(localStorage.getItem(CANVAS_COLOR_KEY));
  } catch {
    return DEFAULT_CANVAS_COLOR;
  }
}

function persistCanvasColor(color) {
  try {
    if (color) {
      localStorage.setItem(CANVAS_COLOR_KEY, color);
    } else {
      localStorage.removeItem(CANVAS_COLOR_KEY);
    }
  } catch {}
}

function applyCanvasColor(color) {
  const root = document.documentElement;
  const normalized = normalizeHexColor(color);
  if (normalized) {
    root.style.setProperty('--moe-canvas-background-color', normalized);
    root.setAttribute('data-canvas-background-custom', 'true');
  } else {
    root.style.removeProperty('--moe-canvas-background-color');
    root.removeAttribute('data-canvas-background-custom');
  }
  return normalized;
}

function addRecentColor(color) {
  const normalized = normalizeHexColor(color);
  if (!normalized) return [];
  const next = [
    normalized,
    ...readJsonArray(CANVAS_RECENT_COLORS_KEY)
      .map(normalizeHexColor)
      .filter((item) => item && item !== normalized),
  ].slice(0, MAX_RECENT_COLORS);
  writeJsonArray(CANVAS_RECENT_COLORS_KEY, next);
  return next;
}

function renderRecentColors(container, applyColor) {
  if (!container) return;
  const colors = readJsonArray(CANVAS_RECENT_COLORS_KEY)
    .map(normalizeHexColor)
    .filter(Boolean)
    .slice(0, MAX_RECENT_COLORS);
  container.innerHTML = '';
  if (colors.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'canvas-color-empty';
    empty.textContent = '暂无最近颜色';
    container.appendChild(empty);
    return;
  }
  colors.forEach((color) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'canvas-color-swatch';
    button.style.setProperty('--swatch-color', color);
    button.setAttribute('aria-label', `使用颜色 ${color}`);
    button.addEventListener('click', () => applyColor(color));
    container.appendChild(button);
  });
}

function getCurrentAppTheme() {
  const activeButton = document.querySelector('#appThemeGroup [data-app-theme].active');
  if (activeButton?.dataset?.appTheme) return activeButton.dataset.appTheme;
  try {
    const stored = localStorage.getItem(APP_THEME_KEY);
    if (APP_THEME_SEQUENCE.includes(stored)) return stored;
  } catch {}
  const rootTheme = document.documentElement.getAttribute('data-app-theme');
  return APP_THEME_SEQUENCE.includes(rootTheme) ? rootTheme : 'dusk';
}

function getNextQuickAppTheme(theme) {
  const index = APP_THEME_SEQUENCE.indexOf(theme);
  return APP_THEME_SEQUENCE[(index + 1 + APP_THEME_SEQUENCE.length) % APP_THEME_SEQUENCE.length];
}

function updateThemeButton(button) {
  if (!button) return;
  const theme = getCurrentAppTheme();
  const nextTheme = getNextQuickAppTheme(theme);
  const nextThemeLabel = APP_THEME_LABELS[nextTheme] || '主题';
  button.dataset.currentTheme = theme;
  button.dataset.nextTheme = nextTheme;
  button.setAttribute('data-tooltip', `切换到${nextThemeLabel}主题`);
  button.setAttribute('aria-label', `切换到${nextThemeLabel}主题`);
}

function syncToolbarPlacementMenu() {
  const placement = document.documentElement.getAttribute(CANVAS_CONTROLS_PLACEMENT_ATTRIBUTE) || DEFAULT_CANVAS_CONTROLS_PLACEMENT;
  document.querySelectorAll('[data-toolbar-placement-action]').forEach((button) => {
    const isActive = button.dataset.toolbarPlacementAction === placement;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function normalizeToolbarPlacement(value) {
  const placement = String(value || '').trim();
  return CANVAS_CONTROLS_PLACEMENTS.has(placement) ? placement : DEFAULT_CANVAS_CONTROLS_PLACEMENT;
}

function persistToolbarPlacement(placement) {
  try {
    localStorage.setItem(CANVAS_CONTROLS_PLACEMENT_KEY, placement);
  } catch {}
}

function applyToolbarPlacementFallback(value) {
  const placement = normalizeToolbarPlacement(value);
  document.documentElement.setAttribute(CANVAS_CONTROLS_PLACEMENT_ATTRIBUTE, placement);
  persistToolbarPlacement(placement);
  window.dispatchEvent(
    new CustomEvent('moe-canvas-controls-placement-changed', {
      detail: { placement },
    }),
  );
  return placement;
}

function triggerThemeSwitch(button) {
  const nextTheme = button?.dataset?.nextTheme || getNextQuickAppTheme(getCurrentAppTheme());
  const target = document.querySelector(`#appThemeGroup [data-app-theme="${nextTheme}"]`);
  if (target) {
    target.click();
  } else {
    try {
      localStorage.setItem(APP_THEME_KEY, nextTheme);
    } catch {}
    document.documentElement.setAttribute('data-app-theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme === 'dusk' ? 'dark' : 'light');
  }
  window.setTimeout(() => updateThemeButton(button), 80);
}

function openSettingsPane(pane) {
  const normalized = pane === 'api' ? 'api-input' : pane;
  const navItem = document.querySelector(`.settings-nav-item[data-pane="${normalized}"]`);
  if (typeof window.openSettingsPanelAtPane === 'function') {
    window.openSettingsPanelAtPane(normalized);
    return;
  }
  getEl('btnOpenSettings')?.click();
  window.setTimeout(() => navItem?.click(), 0);
}

function closePopover(popover, button) {
  if (!popover) return;
  popover.hidden = true;
  button?.setAttribute('aria-expanded', 'false');
}

function openPopover(popover, button) {
  if (!popover) return;
  document
    .querySelectorAll('.canvas-toolbar-popover')
    .forEach((item) => {
      if (item !== popover) item.hidden = true;
    });
  document
    .querySelectorAll('.canvas-controls-floating [aria-expanded="true"]')
    .forEach((item) => {
      if (item !== button) item.setAttribute('aria-expanded', 'false');
    });
  popover.hidden = false;
  button?.setAttribute('aria-expanded', 'true');
}

function togglePopover(popover, button) {
  if (!popover) return;
  if (popover.hidden) openPopover(popover, button);
  else closePopover(popover, button);
}

function setZoomSliderValue(value) {
  const slider = getEl('zoomSlider');
  if (!slider || slider.disabled) return;
  const next = Math.max(0, Math.min(100, Number(value) || 0));
  slider.value = String(next);
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function stepZoom(delta) {
  const slider = getEl('zoomSlider');
  if (!slider || slider.disabled) return;
  setZoomSliderValue(Number(slider.value || 0) + delta);
}

function updatePopoverPercent() {
  const source = getEl('zoomPercent');
  const target = getEl('zoomPopoverPercent');
  if (source && target) target.textContent = source.textContent || '100%';
}

function syncZoomLockUi(enabled) {
  const lockButton = getEl('btnCanvasZoomLock');
  const slider = getEl('zoomSlider');
  const zoomIn = getEl('btnZoomIn');
  const zoomOut = getEl('btnZoomOut');
  lockButton?.classList.toggle('active', enabled);
  lockButton?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  lockButton?.setAttribute('data-tooltip', enabled ? '解除缩放锁定' : '锁定缩放');
  [slider, zoomIn, zoomOut].forEach((item) => {
    if (item) item.disabled = enabled;
  });
}

export function initCanvasToolbarManager({
  isZoomLockEnabled,
  toggleZoomLockEnabled,
  setZoomLockEnabled,
  zoomLockChangeEvent,
  applyCanvasControlsPlacement,
} = {}) {
  const toolbar = document.querySelector('[data-canvas-toolbar]');
  if (!toolbar || toolbar.__canvasToolbarManagerBound) return;
  toolbar.__canvasToolbarManagerBound = true;
  renderIconLibrary(toolbar);

  const zoomPercent = getEl('zoomPercent');
  const zoomPopover = getEl('canvasZoomPopover');
  const menuPopover = getEl('canvasToolbarMenu');
  const colorPopover = getEl('canvasColorPopover');
  const menuButton = getEl('btnCanvasToolbarMenu');
  const colorButton = getEl('btnCanvasToolbarColor');
  const colorInput = getEl('canvasColorInput');
  const recentContainer = getEl('canvasColorRecent');
  const themeButton = getEl('btnCanvasToolbarTheme');

  const applyCanvasColorSelection = (value, { remember = true } = {}) => {
    const color = applyCanvasColor(value);
    persistCanvasColor(color);
    if (colorInput) colorInput.value = color || '#0f1424';
    if (remember && color) addRecentColor(color);
    if (remember) renderRecentColors(recentContainer, applyCanvasColorSelection);
  };

  const initialColor = applyCanvasColor(readCanvasColor());
  if (colorInput && initialColor) colorInput.value = initialColor;
  renderRecentColors(recentContainer, applyCanvasColorSelection);
  updateThemeButton(themeButton);
  updatePopoverPercent();
  syncToolbarPlacementMenu();
  syncZoomLockUi(Boolean(isZoomLockEnabled?.()));

  getEl('btnCanvasToolbarCollapse')?.addEventListener('click', () => {
    toolbar.classList.toggle('is-collapsed');
  });
  getEl('btnCanvasZoomLock')?.addEventListener('click', () => {
    syncZoomLockUi(Boolean(toggleZoomLockEnabled?.()));
  });
  toolbar.addEventListener('dblclick', (event) => {
    if (event.target?.closest?.('#zoomPercent')) return;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  toolbar.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  zoomPercent?.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    updatePopoverPercent();
    openPopover(zoomPopover, zoomPercent);
  });
  getEl('btnZoomClose')?.addEventListener('click', () => closePopover(zoomPopover, zoomPercent));
  getEl('btnZoomIn')?.addEventListener('click', () => stepZoom(5));
  getEl('btnZoomOut')?.addEventListener('click', () => stepZoom(-5));
  getEl('zoomSlider')?.addEventListener('input', updatePopoverPercent);
  themeButton?.addEventListener('click', () => triggerThemeSwitch(themeButton));
  menuButton?.addEventListener('click', () => togglePopover(menuPopover, menuButton));
  colorButton?.addEventListener('click', () => togglePopover(colorPopover, colorButton));
  colorInput?.addEventListener('input', () => applyCanvasColorSelection(colorInput.value, { remember: false }));
  colorInput?.addEventListener('change', () => applyCanvasColorSelection(colorInput.value, { remember: true }));
  getEl('btnCanvasColorReset')?.addEventListener('click', () => {
    applyCanvasColorSelection(DEFAULT_CANVAS_COLOR);
  });
  getEl('btnCanvasToolbarStorage')?.addEventListener('click', () => openSettingsPane('file-save'));
  getEl('btnCanvasToolbarApi')?.addEventListener('click', () => openSettingsPane('api'));
  toolbar.querySelectorAll('[data-toolbar-placement-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const placement = button.dataset.toolbarPlacementAction;
      const appliedPlacement = applyCanvasControlsPlacement?.(placement) || applyToolbarPlacementFallback(placement);
      if (appliedPlacement !== placement) {
        applyToolbarPlacementFallback(placement);
      }
      syncToolbarPlacementMenu();
      closePopover(menuPopover, menuButton);
    });
  });

  document.addEventListener('click', (event) => {
    if (toolbar.contains(event.target)) return;
    closePopover(zoomPopover, zoomPercent);
    closePopover(menuPopover, menuButton);
    closePopover(colorPopover, colorButton);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closePopover(zoomPopover, zoomPercent);
    closePopover(menuPopover, menuButton);
    closePopover(colorPopover, colorButton);
  });
  window.addEventListener(zoomLockChangeEvent || 'moe-zoom-lock-changed', (event) => {
    syncZoomLockUi(Boolean(event.detail?.enabled));
  });
  window.addEventListener('moe-canvas-controls-placement-changed', syncToolbarPlacementMenu);
  window.addEventListener('storage', () => updateThemeButton(themeButton));
  window.setInterval(() => {
    updatePopoverPercent();
    updateThemeButton(themeButton);
  }, 1000);

  if (typeof setZoomLockEnabled === 'function') {
    syncZoomLockUi(Boolean(isZoomLockEnabled?.()));
  }
}