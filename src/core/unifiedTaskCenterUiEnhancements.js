import appStore from './stores/appStore.js';

const STATUS_FILTERS = new Set(['all', 'active', 'failed', 'done']);
const TYPE_FILTERS = new Set(['all', 'image', 'video', 'audio', 'media']);
const ACTIVE_STATUSES = new Set(['waiting', 'processing', 'running', 'queued', 'pending', 'polling']);
const DONE_STATUSES = new Set(['complete', 'cancelled', 'interrupted']);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getStoreState(store = appStore) {
  if (!store) return {};
  if (typeof store.getStateRaw === 'function') return asObject(store.getStateRaw());
  if (typeof store.getState === 'function') return asObject(store.getState());
  return asObject(store.state);
}

function cssEscape(value) {
  if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function resolveTaskUiType(task = {}) {
  const kind = trimString(task.kind).toLowerCase();
  const unifiedKind = trimString(task.unifiedTask?.kind).toLowerCase();
  const text = `${kind} ${unifiedKind}`;
  if (text.includes('image')) return 'image';
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  if (text.includes('media')) return 'media';
  return 'media';
}

export function matchesTaskCenterUiFilters(task = {}, filters = {}) {
  const statusFilter = STATUS_FILTERS.has(filters.status) ? filters.status : 'all';
  const typeFilter = TYPE_FILTERS.has(filters.type) ? filters.type : 'all';
  const status = trimString(task.status);
  const type = resolveTaskUiType(task);

  const statusMatches = statusFilter === 'all'
    || (statusFilter === 'active' && ACTIVE_STATUSES.has(status))
    || (statusFilter === 'failed' && status === 'failed')
    || (statusFilter === 'done' && DONE_STATUSES.has(status));
  const typeMatches = typeFilter === 'all' || typeFilter === type;

  return statusMatches && typeMatches;
}

function createButton(label, value, group, activeValue) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'v2-task-filter-chip';
  button.dataset.taskFilterGroup = group;
  button.dataset.taskFilterValue = value;
  button.textContent = label;
  button.setAttribute('aria-pressed', value === activeValue ? 'true' : 'false');
  return button;
}

function ensureFilterControls(manager) {
  if (!manager?.panel || manager.panel.querySelector('[data-task-filter-controls]')) return;
  const filters = manager.taskCenterFilters || { status: 'all', type: 'all' };
  const controls = document.createElement('div');
  controls.className = 'v2-task-filter-bar';
  controls.dataset.taskFilterControls = '1';

  const statusRow = document.createElement('div');
  statusRow.className = 'v2-task-filter-row';
  statusRow.append(
    createButton('全部', 'all', 'status', filters.status),
    createButton('运行中', 'active', 'status', filters.status),
    createButton('失败', 'failed', 'status', filters.status),
    createButton('已结束', 'done', 'status', filters.status),
  );

  const typeRow = document.createElement('div');
  typeRow.className = 'v2-task-filter-row';
  typeRow.append(
    createButton('全部类型', 'all', 'type', filters.type),
    createButton('图片', 'image', 'type', filters.type),
    createButton('视频', 'video', 'type', filters.type),
    createButton('音频', 'audio', 'type', filters.type),
    createButton('媒体', 'media', 'type', filters.type),
  );

  controls.append(statusRow, typeRow);
  const summary = manager.summaryEl || manager.panel.querySelector('.v2-task-center-summary');
  if (summary?.parentNode) {
    summary.parentNode.insertBefore(controls, summary.nextSibling);
  } else {
    manager.panel.prepend(controls);
  }
}

function syncFilterButtons(manager) {
  const filters = manager.taskCenterFilters || { status: 'all', type: 'all' };
  manager.panel?.querySelectorAll('[data-task-filter-group]').forEach((button) => {
    const group = button.dataset.taskFilterGroup;
    button.setAttribute('aria-pressed', button.dataset.taskFilterValue === filters[group] ? 'true' : 'false');
  });
}

function ensureLocateButtons(manager) {
  const tasks = manager?.tasks;
  if (!manager?.panel || !tasks || typeof tasks.get !== 'function') return;
  manager.panel.querySelectorAll('.v2-task-card[data-task-id]').forEach((card) => {
    const task = tasks.get(card.dataset.taskId);
    if (!task?.nodeId || card.querySelector('[data-task-action="locate-node"]')) return;
    let actions = card.querySelector('.v2-task-card-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'v2-task-card-actions';
      card.appendChild(actions);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'v2-task-card-action';
    button.dataset.taskAction = 'locate-node';
    button.dataset.nodeId = task.nodeId;
    button.textContent = '定位节点';
    actions.prepend(button);
  });
}

function syncInterruptedStatusBadges(manager) {
  const tasks = manager?.tasks;
  if (!manager?.panel || !tasks || typeof tasks.get !== 'function') return;
  manager.panel.querySelectorAll('.v2-task-card[data-task-id]').forEach((card) => {
    const task = tasks.get(card.dataset.taskId);
    if (task?.status !== 'interrupted') return;
    const badge = card.querySelector('.v2-task-status');
    if (!badge) return;
    badge.textContent = '已中断';
    badge.classList.remove('v2-task-status--failed');
    badge.classList.add('v2-task-status--interrupted');
  });
}

function applyTaskDomFilters(manager) {
  const tasks = manager?.tasks;
  if (!manager?.listEl || !tasks || typeof tasks.get !== 'function') return;
  const filters = manager.taskCenterFilters || { status: 'all', type: 'all' };
  let visibleCount = 0;

  manager.listEl.querySelectorAll('.v2-task-card[data-task-id]').forEach((card) => {
    const task = tasks.get(card.dataset.taskId);
    const visible = task ? matchesTaskCenterUiFilters(task, filters) : true;
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  manager.listEl.querySelectorAll('.v2-task-center-section').forEach((section) => {
    const cards = Array.from(section.querySelectorAll('.v2-task-card[data-task-id]'));
    section.hidden = cards.length > 0 && cards.every((card) => card.hidden);
  });

  const oldEmpty = manager.listEl.querySelector('[data-task-filter-empty]');
  if (oldEmpty) oldEmpty.remove();
  const hasAnyCard = manager.listEl.querySelector('.v2-task-card[data-task-id]');
  if (hasAnyCard && visibleCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'v2-task-center-empty v2-task-center-filter-empty';
    empty.dataset.taskFilterEmpty = '1';
    empty.textContent = '当前筛选下没有任务';
    manager.listEl.appendChild(empty);
  }
}

export function focusTaskNode(nodeId, options = {}) {
  const id = trimString(nodeId);
  if (!id) return false;
  const escaped = cssEscape(id);
  const nodeEl = document.querySelector(`.v2-node[data-node-id="${escaped}"], .v2-node#${escaped}`);
  if (!nodeEl) return false;

  nodeEl.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
  nodeEl.classList.add('v2-task-node-focus-pulse');
  window.setTimeout?.(() => nodeEl.classList.remove('v2-task-node-focus-pulse'), 1600);

  const store = options.store || appStore;
  const state = getStoreState(store);
  if (state && Array.isArray(state.selectedNodeIds)) {
    state.selectedNodeIds = [id];
  }
  return true;
}

function handleEnhancementClick(manager, event) {
  const filterButton = event.target?.closest?.('[data-task-filter-group]');
  if (filterButton) {
    event.preventDefault();
    event.stopPropagation();
    const group = filterButton.dataset.taskFilterGroup;
    const value = filterButton.dataset.taskFilterValue;
    manager.taskCenterFilters = {
      ...(manager.taskCenterFilters || { status: 'all', type: 'all' }),
      [group]: value,
    };
    syncFilterButtons(manager);
    applyTaskDomFilters(manager);
    return true;
  }

  const locateButton = event.target?.closest?.('[data-task-action="locate-node"]');
  if (locateButton) {
    event.preventDefault();
    event.stopPropagation();
    const ok = focusTaskNode(locateButton.dataset.nodeId || '');
    if (!ok) window.showToast?.('未找到对应节点', 'error');
    return true;
  }

  return false;
}

function refreshEnhancements(manager) {
  ensureFilterControls(manager);
  syncFilterButtons(manager);
  ensureLocateButtons(manager);
  syncInterruptedStatusBadges(manager);
  applyTaskDomFilters(manager);
}

function stopTaskCenterScrollPropagation(event) {
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
}

function bindTaskCenterScrollIsolation(manager) {
  const panel = manager?.panel;
  if (!panel || panel.__unifiedTaskCenterScrollIsolationInstalled) return;
  panel.addEventListener?.('wheel', stopTaskCenterScrollPropagation, { capture: true, passive: true });
  panel.addEventListener?.('mousewheel', stopTaskCenterScrollPropagation, { capture: true, passive: true });
  panel.addEventListener?.('DOMMouseScroll', stopTaskCenterScrollPropagation, { capture: true, passive: true });
  panel.addEventListener?.('touchmove', stopTaskCenterScrollPropagation, { capture: true, passive: true });
  Object.defineProperty(panel, '__unifiedTaskCenterScrollIsolationInstalled', {
    value: true,
    enumerable: false,
    configurable: true,
  });
}

export function installTaskCenterUiEnhancements(manager) {
  if (!manager || manager.__unifiedTaskCenterUiEnhancementsInstalled) return manager;
  manager.taskCenterFilters = manager.taskCenterFilters || { status: 'all', type: 'all' };
  bindTaskCenterScrollIsolation(manager);

  const originalRender = typeof manager.render === 'function' ? manager.render.bind(manager) : null;
  if (originalRender) {
    manager.render = (...args) => {
      const result = originalRender(...args);
      refreshEnhancements(manager);
      return result;
    };
  }

  manager.panel?.addEventListener?.('click', (event) => {
    handleEnhancementClick(manager, event);
  }, true);

  refreshEnhancements(manager);
  Object.defineProperty(manager, '__unifiedTaskCenterUiEnhancementsInstalled', {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return manager;
}

export const __test__ = {
  ACTIVE_STATUSES,
  DONE_STATUSES,
  applyTaskDomFilters,
  bindTaskCenterScrollIsolation,
  ensureFilterControls,
  ensureLocateButtons,
  handleEnhancementClick,
  refreshEnhancements,
  syncInterruptedStatusBadges,
};