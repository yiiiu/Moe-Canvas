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

export async function fetchAssetRetentionPolicySettings() {
  const payload = await requestJson('/api/v2/assets/retention/policy', { method: 'GET' });
  return payload?.policy || {};
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
  if (!saveButton || saveButton.__assetRetentionBound) {
    return;
  }
  saveButton.__assetRetentionBound = true;
  fetchAssetRetentionPolicySettings()
    .then(renderAssetRetentionPolicyForm)
    .catch(() => setStatus('加载生命周期策略失败', 'error'));
  saveButton.addEventListener('click', () => {
    void __saveAssetRetentionPolicySettings();
  });
  evaluateButton?.addEventListener('click', () => {
    void __evaluateAssetRetentionPolicySettings();
  });
  applyButton?.addEventListener('click', () => {
    void __applyAssetRetentionPolicySettings();
  });
}