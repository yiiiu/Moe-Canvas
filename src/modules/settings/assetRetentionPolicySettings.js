import { formatStorageUsageBytes } from './storageUsageSettings.js';

const DEFAULT_RETENTION_POLICY = Object.freeze({
  enabled: true,
  orphanRetentionDays: 7,
  tempRetentionHours: 24,
  deleteCandidateOnly: true,
  autoDelete: false,
  minAssetAgeHours: 1,
  excludePinned: true,
  excludeRecentlyUsedHours: 24,
});

const DEFAULT_RETENTION_SCHEDULER = Object.freeze({
  enabled: false,
  intervalHours: 24,
  runOnStartup: false,
  markCandidates: true,
  autoDelete: false,
  maxAssetsPerRun: 500,
  lastRunAt: 0,
  nextRunAt: 0,
});

const FIELD_IDS = Object.freeze({
  enabled: 'assetRetentionEnabled',
  orphanRetentionDays: 'assetRetentionOrphanDays',
  minAssetAgeHours: 'assetRetentionMinAssetAgeHours',
  deleteCandidateOnly: 'assetRetentionDeleteCandidateOnly',
  autoDeleteStatus: 'assetRetentionAutoDeleteStatus',
  saveButton: 'btnAssetRetentionPolicySave',
  evaluateButton: 'btnAssetRetentionEvaluate',
  applyButton: 'btnAssetRetentionApply',
  status: 'assetRetentionStatus',
  candidateCount: 'assetRetentionCandidateCount',
  reclaimable: 'assetRetentionReclaimable',
  candidateList: 'assetRetentionCandidateList',
  schedulerEnabled: 'assetRetentionSchedulerEnabled',
  schedulerIntervalHours: 'assetRetentionSchedulerIntervalHours',
  schedulerRunOnStartup: 'assetRetentionSchedulerRunOnStartup',
  schedulerMarkCandidates: 'assetRetentionSchedulerMarkCandidates',
  schedulerAutoDeleteStatus: 'assetRetentionSchedulerAutoDeleteStatus',
  schedulerLastRunAt: 'assetRetentionSchedulerLastRunAt',
  schedulerNextRunAt: 'assetRetentionSchedulerNextRunAt',
  schedulerSaveButton: 'btnAssetRetentionSchedulerSave',
  schedulerRunNowButton: 'btnAssetRetentionSchedulerRunNow',
  schedulerStatus: 'assetRetentionSchedulerStatus',
  schedulerRuns: 'assetRetentionSchedulerRuns',
  cleanupQueueCount: 'assetCleanupQueueCount',
  cleanupQueueBytes: 'assetCleanupQueueBytes',
  cleanupQueueByType: 'assetCleanupQueueByType',
  cleanupQueueByStorage: 'assetCleanupQueueByStorage',
  cleanupQueueList: 'assetCleanupQueueList',
  cleanupQueueTypeFilter: 'assetCleanupQueueTypeFilter',
  cleanupQueueStorageFilter: 'assetCleanupQueueStorageFilter',
  cleanupQueueSort: 'assetCleanupQueueSort',
  cleanupQueueRefreshButton: 'btnAssetCleanupQueueRefresh',
  cleanupQueueDryRunButton: 'btnAssetCleanupQueueDryRun',
  cleanupQueueDeleteButton: 'btnAssetCleanupQueueDelete',
  cleanupQueueRejectButton: 'btnAssetCleanupQueueReject',
  cleanupQueueStatus: 'assetCleanupQueueStatus',
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

function setCleanupQueueCustomSelectOpen(control, open) {
  if (!control) {
    return;
  }
  control.dataset.open = open ? 'true' : 'false';
  const trigger = control.querySelector?.('[data-cleanup-queue-select-trigger]');
  trigger?.setAttribute?.('aria-expanded', open ? 'true' : 'false');
}

function setCleanupQueueCustomSelectValue(control, value, label) {
  const valueLabel = control?.querySelector?.('[data-cleanup-queue-select-value]');
  if (valueLabel) {
    valueLabel.textContent = label || value || '全部';
  }
  for (const option of control?.querySelectorAll?.('[data-cleanup-queue-option]') || []) {
    const selected = String(option?.dataset?.value ?? '') === String(value ?? '');
    option.dataset.selected = selected ? 'true' : 'false';
    option.setAttribute?.('aria-selected', selected ? 'true' : 'false');
  }
}

export function __bindAssetCleanupQueueFilterControls(controls = Array.from(document.querySelectorAll?.('[data-cleanup-queue-select]') || [])) {
  for (const control of controls || []) {
    if (!control || control.__assetCleanupQueueSelectBound) {
      continue;
    }
    control.__assetCleanupQueueSelectBound = true;
    const inputId = control.dataset?.cleanupQueueSelect || '';
    const input = element(inputId);
    const trigger = control.querySelector?.('[data-cleanup-queue-select-trigger]') || control;
    const options = Array.from(control.querySelectorAll?.('[data-cleanup-queue-option]') || []);
    const currentValue = String(input?.value ?? '');
    const currentOption = options.find(option => String(option?.dataset?.value ?? '') === currentValue) || options[0];
    setCleanupQueueCustomSelectValue(control, currentValue, currentOption?.textContent || '全部');
    setCleanupQueueCustomSelectOpen(control, false);
    trigger?.addEventListener?.('click', event => {
      event?.preventDefault?.();
      setCleanupQueueCustomSelectOpen(control, control.dataset?.open !== 'true');
    });
    for (const option of options) {
      option.addEventListener?.('click', async event => {
        event?.preventDefault?.();
        const value = String(option?.dataset?.value ?? '');
        if (input) {
          input.value = value;
        }
        setCleanupQueueCustomSelectValue(control, value, option?.textContent || value || '全部');
        setCleanupQueueCustomSelectOpen(control, false);
        await __refreshAssetCleanupQueueSettings();
      });
    }
  }
}

function setText(id, value) {
  const target = element(id);
  if (target) {
    target.textContent = value || '';
  }
}

function setStatus(message, tone = '') {
  const target = element(FIELD_IDS.status);
  if (!target) {
    return;
  }
  target.textContent = message || '';
  target.dataset.status = tone;
}

function setBusy(button, busy, idleText) {
  if (!button) {
    return;
  }
  button.disabled = !!busy;
  button.textContent = busy ? '处理中...' : idleText;
}

function safeInt(value, fallback, min, max) {
  const parsed = Math.round(number(value) || fallback);
  return clamp(parsed, min, max);
}

export function normalizeAssetRetentionPolicySettings(value = {}) {
  const source = value?.assetRetentionPolicy && !Array.isArray(value.assetRetentionPolicy)
    ? value.assetRetentionPolicy
    : value;
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_RETENTION_POLICY.enabled,
    orphanRetentionDays: safeInt(source.orphanRetentionDays, DEFAULT_RETENTION_POLICY.orphanRetentionDays, 0, 3650),
    tempRetentionHours: safeInt(source.tempRetentionHours, DEFAULT_RETENTION_POLICY.tempRetentionHours, 1, 24 * 365),
    deleteCandidateOnly: true,
    autoDelete: false,
    minAssetAgeHours: safeInt(source.minAssetAgeHours, DEFAULT_RETENTION_POLICY.minAssetAgeHours, 0, 24 * 3650),
    excludePinned: source.excludePinned !== undefined ? !!source.excludePinned : DEFAULT_RETENTION_POLICY.excludePinned,
    excludeRecentlyUsedHours: safeInt(
      source.excludeRecentlyUsedHours,
      DEFAULT_RETENTION_POLICY.excludeRecentlyUsedHours,
      0,
      24 * 3650,
    ),
  };
}

export function normalizeAssetRetentionSchedulerSettings(value = {}) {
  const source = value?.retentionScheduler && !Array.isArray(value.retentionScheduler)
    ? value.retentionScheduler
    : value;
  return {
    enabled: source.enabled !== undefined ? !!source.enabled : DEFAULT_RETENTION_SCHEDULER.enabled,
    intervalHours: source.intervalHours !== undefined
      ? clamp(Math.round(number(source.intervalHours)), 1, 24 * 365)
      : DEFAULT_RETENTION_SCHEDULER.intervalHours,
    runOnStartup: source.runOnStartup !== undefined ? !!source.runOnStartup : DEFAULT_RETENTION_SCHEDULER.runOnStartup,
    markCandidates: source.markCandidates !== undefined ? !!source.markCandidates : DEFAULT_RETENTION_SCHEDULER.markCandidates,
    autoDelete: false,
    maxAssetsPerRun: source.maxAssetsPerRun !== undefined
      ? clamp(Math.round(number(source.maxAssetsPerRun)), 1, 10000)
      : DEFAULT_RETENTION_SCHEDULER.maxAssetsPerRun,
    lastRunAt: source.lastRunAt !== undefined
      ? clamp(Math.round(number(source.lastRunAt)), 0, Number.MAX_SAFE_INTEGER)
      : DEFAULT_RETENTION_SCHEDULER.lastRunAt,
    nextRunAt: source.nextRunAt !== undefined
      ? clamp(Math.round(number(source.nextRunAt)), 0, Number.MAX_SAFE_INTEGER)
      : DEFAULT_RETENTION_SCHEDULER.nextRunAt,
  };
}

export function readAssetRetentionPolicyForm() {
  return normalizeAssetRetentionPolicySettings({
    enabled: readChecked(FIELD_IDS.enabled),
    orphanRetentionDays: readValue(FIELD_IDS.orphanRetentionDays),
    minAssetAgeHours: readValue(FIELD_IDS.minAssetAgeHours),
    deleteCandidateOnly: readChecked(FIELD_IDS.deleteCandidateOnly),
    autoDelete: false,
    tempRetentionHours: DEFAULT_RETENTION_POLICY.tempRetentionHours,
    excludePinned: true,
    excludeRecentlyUsedHours: DEFAULT_RETENTION_POLICY.excludeRecentlyUsedHours,
  });
}

export function readAssetRetentionSchedulerForm() {
  return normalizeAssetRetentionSchedulerSettings({
    enabled: readChecked(FIELD_IDS.schedulerEnabled),
    intervalHours: readValue(FIELD_IDS.schedulerIntervalHours),
    runOnStartup: readChecked(FIELD_IDS.schedulerRunOnStartup),
    markCandidates: readChecked(FIELD_IDS.schedulerMarkCandidates),
    autoDelete: false,
    maxAssetsPerRun: DEFAULT_RETENTION_SCHEDULER.maxAssetsPerRun,
    lastRunAt: 0,
    nextRunAt: 0,
  });
}

function formatSchedulerTime(value, emptyText) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return emptyText;
  }
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return emptyText;
  }
}

export function renderAssetRetentionSchedulerForm(scheduler = {}) {
  const normalized = normalizeAssetRetentionSchedulerSettings(scheduler);
  setChecked(FIELD_IDS.schedulerEnabled, normalized.enabled);
  setValue(FIELD_IDS.schedulerIntervalHours, String(normalized.intervalHours));
  setChecked(FIELD_IDS.schedulerRunOnStartup, normalized.runOnStartup);
  setChecked(FIELD_IDS.schedulerMarkCandidates, normalized.markCandidates);
  setText(FIELD_IDS.schedulerAutoDeleteStatus, '自动删除不支持 / 已禁用');
  setText(FIELD_IDS.schedulerLastRunAt, formatSchedulerTime(normalized.lastRunAt, '从未运行'));
  setText(FIELD_IDS.schedulerNextRunAt, formatSchedulerTime(normalized.nextRunAt, '未计划'));
}

export function renderAssetRetentionPolicyForm(policy = {}) {
  const normalized = normalizeAssetRetentionPolicySettings(policy);
  setChecked(FIELD_IDS.enabled, normalized.enabled);
  setValue(FIELD_IDS.orphanRetentionDays, String(normalized.orphanRetentionDays));
  setValue(FIELD_IDS.minAssetAgeHours, String(normalized.minAssetAgeHours));
  setChecked(FIELD_IDS.deleteCandidateOnly, true);
  setText(FIELD_IDS.autoDeleteStatus, '当前版本不支持自动删除');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || '生命周期策略请求失败');
  }
  return payload;
}

function renderRetentionResult(payload = {}, mode = 'evaluate') {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const marked = Array.isArray(payload.marked) ? payload.marked : [];
  const count = mode === 'apply' ? marked.length : Number(payload.candidateCount ?? candidates.length) || 0;
  setText(FIELD_IDS.candidateCount, String(count));
  setText(FIELD_IDS.reclaimable, formatStorageUsageBytes(payload.reclaimableBytes || 0));

  const list = element(FIELD_IDS.candidateList);
  if (list) {
    const items = mode === 'apply' && marked.length ? marked : candidates;
    list.replaceChildren?.();
    list.hidden = items.length === 0;
    for (const item of items.slice(0, 20)) {
      const row = document.createElement('div');
      row.className = 'settings-retention-candidate-item';
      const assetId = item?.assetId || 'unknown';
      const size = item?.size ? ` · ${formatStorageUsageBytes(item.size)}` : '';
      row.textContent = `${assetId}${size}`;
      list.appendChild(row);
    }
  }
}

export function renderAssetRetentionSchedulerRuns(runs = []) {
  const list = element(FIELD_IDS.schedulerRuns);
  if (!list) {
    return;
  }
  const items = Array.isArray(runs) ? runs : [];
  list.replaceChildren?.();
  list.hidden = items.length === 0;
  for (const item of items.slice(-10).reverse()) {
    const row = document.createElement('div');
    row.className = 'settings-retention-scheduler-run-item';
    const mode = item?.mode || 'manual';
    const status = item?.status || 'unknown';
    const marked = Number(item?.markedCount || 0);
    const candidates = Number(item?.candidateCount || 0);
    const size = formatStorageUsageBytes(item?.candidateBytes || 0);
    row.textContent = `${mode} · ${status} · 候选 ${candidates} · 标记 ${marked} · ${size}`;
    list.appendChild(row);
  }
}

function formatCleanupBreakdown(value = {}) {
  return Object.entries(value || {})
    .map(([key, item]) => `${key}: ${Number(item?.count || 0)} / ${formatStorageUsageBytes(item?.bytes || 0)}`)
    .join('；') || '—';
}

function setCleanupQueueStatus(message, tone = '') {
  const target = element(FIELD_IDS.cleanupQueueStatus);
  if (!target) {
    return;
  }
  target.textContent = message || '';
  target.dataset.status = tone;
}

function selectedCleanupQueueAssetIds() {
  const list = element(FIELD_IDS.cleanupQueueList);
  const boxes = list?.querySelectorAll?.('input[data-asset-id]') || [];
  return Array.from(boxes)
    .filter(box => box.checked)
    .map(box => String(box.dataset.assetId || '').trim())
    .filter(Boolean);
}

function renderCleanupQueueDryRunResults(results = []) {
  const byId = new Map((Array.isArray(results) ? results : []).map(item => [String(item?.assetId || ''), item]));
  const list = element(FIELD_IDS.cleanupQueueList);
  for (const row of list?.children || []) {
    const assetId = String(row?.dataset?.assetId || '');
    const item = byId.get(assetId);
    if (!item) {
      continue;
    }
    const result = row.querySelector?.('[data-cleanup-result]');
    const text = item.canDelete
      ? `可删除 · ${formatStorageUsageBytes(item.releasableBytes || 0)}`
      : `blocked · ${item.reason || 'blocked'}`;
    if (result) {
      result.textContent = text;
      result.dataset.status = item.canDelete ? 'success' : 'error';
    } else {
      row.textContent += ` · ${text}`;
    }
  }
}

export function renderAssetCleanupQueue(payload = {}) {
  if (payload.dryRunResults) {
    renderCleanupQueueDryRunResults(payload.dryRunResults);
    return;
  }
  const queue = Array.isArray(payload.queue) ? payload.queue : [];
  const summary = payload.summary || {};
  setText(FIELD_IDS.cleanupQueueCount, String(summary.totalCount ?? queue.length));
  setText(FIELD_IDS.cleanupQueueBytes, formatStorageUsageBytes(summary.totalBytes || 0));
  setText(FIELD_IDS.cleanupQueueByType, formatCleanupBreakdown(summary.byType));
  setText(FIELD_IDS.cleanupQueueByStorage, formatCleanupBreakdown(summary.byStorage));
  const list = element(FIELD_IDS.cleanupQueueList);
  if (!list) {
    return;
  }
  list.replaceChildren?.();
  list.hidden = queue.length === 0;
  for (const item of queue) {
    const row = document.createElement('label');
    row.className = 'settings-cleanup-queue-item';
    row.dataset.assetId = item?.assetId || '';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.assetId = item?.assetId || '';
    const body = document.createElement('span');
    body.className = 'settings-cleanup-queue-item-body';
    const storage = item?.storage || {};
    const usageCount = Number(item?.usage?.usageCount || 0);
    body.textContent = `${item?.assetId || 'unknown'} · ${item?.type || 'file'} · ${storage.type || 'local'}${storage.bucket ? `/${storage.bucket}` : ''} · ${formatStorageUsageBytes(item?.size || 0)} · usage ${usageCount}${item?.pinned ? ' · pinned' : ''}`;
    const result = document.createElement('span');
    result.className = 'settings-cleanup-queue-result';
    result.dataset.cleanupResult = 'true';
    row.appendChild(checkbox);
    row.appendChild(body);
    row.appendChild(result);
    list.appendChild(row);
  }
}

function cleanupQueueQueryString() {
  const params = new URLSearchParams();
  const type = readValue(FIELD_IDS.cleanupQueueTypeFilter);
  const storageType = readValue(FIELD_IDS.cleanupQueueStorageFilter);
  const sort = readValue(FIELD_IDS.cleanupQueueSort) || 'size_desc';
  if (type) {
    params.set('type', type);
  }
  if (storageType) {
    params.set('storageType', storageType);
  }
  params.set('sort', sort);
  params.set('page', '1');
  params.set('pageSize', '50');
  return params.toString();
}

export async function __refreshAssetCleanupQueueSettings() {
  const button = element(FIELD_IDS.cleanupQueueRefreshButton);
  setBusy(button, true, '刷新队列');
  try {
    const payload = await requestJson(`/api/v2/assets/cleanup-queue?${cleanupQueueQueryString()}`);
    renderAssetCleanupQueue(payload);
    setCleanupQueueStatus(`待清理 ${payload.summary?.totalCount ?? payload.queue?.length ?? 0} 项，预计释放 ${formatStorageUsageBytes(payload.summary?.totalBytes || 0)}`, 'success');
    return payload;
  } catch (error) {
    setCleanupQueueStatus(error?.message || '加载清理队列失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '刷新队列');
  }
}

export async function __dryRunAssetCleanupQueueSettings() {
  const button = element(FIELD_IDS.cleanupQueueDryRunButton);
  const assetIds = selectedCleanupQueueAssetIds();
  if (!assetIds.length) {
    setCleanupQueueStatus('请选择要预检的资产', 'error');
    return null;
  }
  setBusy(button, true, '批量 dryRun');
  try {
    const payload = await requestJson('/api/v2/assets/cleanup-queue/dry-run', {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    });
    renderAssetCleanupQueue({ dryRunResults: payload.results || [] });
    const releasable = (payload.results || []).reduce((sum, item) => sum + Number(item?.releasableBytes || 0), 0);
    const blocked = (payload.results || []).filter(item => item?.canDelete !== true).length;
    setCleanupQueueStatus(`dryRun 完成，预计释放 ${formatStorageUsageBytes(releasable)}，blocked ${blocked} 项`, blocked ? 'error' : 'success');
    return payload;
  } catch (error) {
    setCleanupQueueStatus(error?.message || '清理队列 dryRun 失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '批量 dryRun');
  }
}

export async function __deleteAssetCleanupQueueSettings() {
  const button = element(FIELD_IDS.cleanupQueueDeleteButton);
  const assetIds = selectedCleanupQueueAssetIds();
  if (!assetIds.length) {
    setCleanupQueueStatus('请选择要删除的资产', 'error');
    return null;
  }
  const confirmed = globalThis.confirm?.('删除后将移除 MinIO/S3/本地文件，但保留 AssetRecord 审计。确认删除所选资产？') === true;
  if (!confirmed) {
    setCleanupQueueStatus('已取消删除', '');
    return null;
  }
  setBusy(button, true, '确认删除所选');
  try {
    const payload = await requestJson('/api/v2/assets/cleanup-queue/delete', {
      method: 'POST',
      body: JSON.stringify({ assetIds, confirm: true }),
    });
    const deleted = (payload.results || []).filter(item => item?.deleted === true).length;
    const blocked = (payload.results || []).filter(item => item?.deleted !== true).length;
    const releasable = (payload.results || []).reduce((sum, item) => sum + Number(item?.releasableBytes || 0), 0);
    await __refreshAssetCleanupQueueSettings();
    setCleanupQueueStatus(`删除完成 ${deleted} 项，blocked ${blocked} 项，释放 ${formatStorageUsageBytes(releasable)}`, blocked ? 'error' : 'success');
    return payload;
  } catch (error) {
    setCleanupQueueStatus(error?.message || '清理队列删除失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '确认删除所选');
  }
}

export async function __rejectAssetCleanupQueueSettings() {
  const button = element(FIELD_IDS.cleanupQueueRejectButton);
  const assetIds = selectedCleanupQueueAssetIds();
  if (!assetIds.length) {
    setCleanupQueueStatus('请选择要拒绝的资产', 'error');
    return null;
  }
  setBusy(button, true, '拒绝清理所选');
  try {
    const payload = await requestJson('/api/v2/assets/cleanup-queue/reject', {
      method: 'POST',
      body: JSON.stringify({ assetIds, reason: 'manual_reject' }),
    });
    const rejected = (payload.results || []).filter(item => item?.rejected === true).length;
    await __refreshAssetCleanupQueueSettings();
    setCleanupQueueStatus(`已拒绝 ${rejected} 项，文件未删除`, 'success');
    return payload;
  } catch (error) {
    setCleanupQueueStatus(error?.message || '拒绝清理失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '拒绝清理所选');
  }
}

export async function fetchAssetRetentionPolicySettings() {
  const payload = await requestJson('/api/v2/assets/retention/policy', { method: 'GET' });
  return payload?.policy || {};
}

export async function fetchAssetRetentionSchedulerSettings() {
  const payload = await requestJson('/api/v2/assets/retention/scheduler', { method: 'GET' });
  return payload?.scheduler || {};
}

export async function fetchAssetRetentionSchedulerRuns() {
  const payload = await requestJson('/api/v2/assets/retention/scheduler/runs', { method: 'GET' });
  renderAssetRetentionSchedulerRuns(payload?.runs || []);
  return payload;
}

export async function __saveAssetRetentionSchedulerSettings() {
  const button = element(FIELD_IDS.schedulerSaveButton);
  const scheduler = readAssetRetentionSchedulerForm();
  setBusy(button, true, '保存调度器');
  try {
    const payload = await requestJson('/api/v2/assets/retention/scheduler', {
      method: 'PUT',
      body: JSON.stringify(scheduler),
    });
    renderAssetRetentionSchedulerForm(payload.scheduler || scheduler);
    const warning = Array.isArray(payload.warnings) && payload.warnings.length ? '；自动删除已强制禁用' : '';
    setText(FIELD_IDS.schedulerStatus, `调度器设置已保存${warning}`);
    element(FIELD_IDS.schedulerStatus)?.dataset && (element(FIELD_IDS.schedulerStatus).dataset.status = 'success');
    return payload;
  } catch (error) {
    setText(FIELD_IDS.schedulerStatus, error?.message || '保存调度器失败');
    element(FIELD_IDS.schedulerStatus)?.dataset && (element(FIELD_IDS.schedulerStatus).dataset.status = 'error');
    return null;
  } finally {
    setBusy(button, false, '保存调度器');
  }
}

export async function __runAssetRetentionSchedulerNow() {
  const button = element(FIELD_IDS.schedulerRunNowButton);
  setBusy(button, true, '立即评估 / 标记候选');
  try {
    const payload = await requestJson('/api/v2/assets/retention/scheduler/run', {
      method: 'POST',
      body: JSON.stringify({ mode: 'manual', dryRun: false }),
    });
    if (payload.scheduler) {
      renderAssetRetentionSchedulerForm(payload.scheduler);
    }
    const run = payload.run || {};
    const marked = Number(run.markedCount || 0);
    setText(FIELD_IDS.schedulerStatus, `调度器运行已完成，已标记 ${marked} 个候选；未删除任何文件`);
    element(FIELD_IDS.schedulerStatus)?.dataset && (element(FIELD_IDS.schedulerStatus).dataset.status = 'success');
    await fetchAssetRetentionSchedulerRuns().catch(() => null);
    return payload;
  } catch (error) {
    setText(FIELD_IDS.schedulerStatus, error?.message || '运行调度器失败');
    element(FIELD_IDS.schedulerStatus)?.dataset && (element(FIELD_IDS.schedulerStatus).dataset.status = 'error');
    return null;
  } finally {
    setBusy(button, false, '立即评估 / 标记候选');
  }
}

export async function __saveAssetRetentionPolicySettings() {
  const button = element(FIELD_IDS.saveButton);
  const policy = readAssetRetentionPolicyForm();
  setBusy(button, true, '保存策略');
  try {
    const payload = await requestJson('/api/v2/assets/retention/policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    });
    renderAssetRetentionPolicyForm(payload.policy || policy);
    setStatus('生命周期策略已保存', 'success');
    return payload;
  } catch (error) {
    setStatus(error?.message || '保存生命周期策略失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '保存策略');
  }
}

export async function __evaluateAssetRetentionPolicySettings() {
  const button = element(FIELD_IDS.evaluateButton);
  const policy = readAssetRetentionPolicyForm();
  setBusy(button, true, '评估可清理资源');
  try {
    const payload = await requestJson('/api/v2/assets/retention/evaluate', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, policy }),
    });
    renderRetentionResult(payload, 'evaluate');
    setStatus(`发现 ${payload.candidateCount ?? payload.candidates?.length ?? 0} 个可标记候选`, 'success');
    return payload;
  } catch (error) {
    setStatus(error?.message || '评估生命周期策略失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '评估可清理资源');
  }
}

export async function __applyAssetRetentionPolicySettings() {
  const button = element(FIELD_IDS.applyButton);
  const policy = readAssetRetentionPolicyForm();
  setBusy(button, true, '标记为清理候选');
  try {
    const payload = await requestJson('/api/v2/assets/retention/apply', {
      method: 'POST',
      body: JSON.stringify({ policy }),
    });
    renderRetentionResult(payload, 'apply');
    const markedCount = Array.isArray(payload.marked) ? payload.marked.length : 0;
    setStatus(`已标记 ${markedCount} 个清理候选；未删除任何文件`, 'success');
    return payload;
  } catch (error) {
    setStatus(error?.message || '标记清理候选失败', 'error');
    return null;
  } finally {
    setBusy(button, false, '标记为清理候选');
  }
}

export function initAssetRetentionPolicySettings() {
  const saveButton = element(FIELD_IDS.saveButton);
  const evaluateButton = element(FIELD_IDS.evaluateButton);
  const applyButton = element(FIELD_IDS.applyButton);
  const schedulerSaveButton = element(FIELD_IDS.schedulerSaveButton);
  const schedulerRunNowButton = element(FIELD_IDS.schedulerRunNowButton);
  const cleanupQueueRefreshButton = element(FIELD_IDS.cleanupQueueRefreshButton);
  const cleanupQueueDryRunButton = element(FIELD_IDS.cleanupQueueDryRunButton);
  const cleanupQueueDeleteButton = element(FIELD_IDS.cleanupQueueDeleteButton);
  const cleanupQueueRejectButton = element(FIELD_IDS.cleanupQueueRejectButton);
  const cleanupQueueFilterControls = Array.from(document.querySelectorAll?.('[data-cleanup-queue-select]') || []);
  if (!saveButton || saveButton.__assetRetentionBound) {
    return;
  }
  saveButton.__assetRetentionBound = true;
  fetchAssetRetentionPolicySettings()
    .then(renderAssetRetentionPolicyForm)
    .catch(() => setStatus('加载生命周期策略失败', 'error'));
  fetchAssetRetentionSchedulerSettings()
    .then(renderAssetRetentionSchedulerForm)
    .catch(() => {
      const target = element(FIELD_IDS.schedulerStatus);
      if (target) {
        target.textContent = '加载调度器失败';
        target.dataset.status = 'error';
      }
    });
  void fetchAssetRetentionSchedulerRuns().catch(() => null);
  void __refreshAssetCleanupQueueSettings().catch(() => null);
  saveButton.addEventListener('click', () => {
    void __saveAssetRetentionPolicySettings();
  });
  evaluateButton?.addEventListener('click', () => {
    void __evaluateAssetRetentionPolicySettings();
  });
  applyButton?.addEventListener('click', () => {
    void __applyAssetRetentionPolicySettings();
  });
  schedulerSaveButton?.addEventListener('click', () => {
    void __saveAssetRetentionSchedulerSettings();
  });
  schedulerRunNowButton?.addEventListener('click', () => {
    void __runAssetRetentionSchedulerNow();
  });
  cleanupQueueRefreshButton?.addEventListener('click', () => {
    void __refreshAssetCleanupQueueSettings();
  });
  cleanupQueueDryRunButton?.addEventListener('click', () => {
    void __dryRunAssetCleanupQueueSettings();
  });
  cleanupQueueDeleteButton?.addEventListener('click', () => {
    void __deleteAssetCleanupQueueSettings();
  });
  cleanupQueueRejectButton?.addEventListener('click', () => {
    void __rejectAssetCleanupQueueSettings();
  });
  __bindAssetCleanupQueueFilterControls(cleanupQueueFilterControls);
}