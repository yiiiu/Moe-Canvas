const STORAGE_USAGE_IDS = Object.freeze({
  card: 'storageUsageCard',
  total: 'storageUsageTotal',
  quotaLimit: 'storageUsageQuotaLimit',
  percent: 'storageUsagePercent',
  image: 'storageUsageTypeImage',
  video: 'storageUsageTypeVideo',
  audio: 'storageUsageTypeAudio',
  file: 'storageUsageTypeFile',
  local: 'storageUsageLocal',
  s3: 'storageUsageS3Compatible',
  orphan: 'storageUsageOrphan',
  deleted: 'storageUsageDeleted',
  status: 'storageUsageStatus',
  blockMode: 'storageUsageBlockMode',
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const target = element(id);
  if (target) {
    target.textContent = value;
  }
}

function bytesOf(group, key) {
  const item = group?.[key];
  return number(item?.bytes);
}

export function formatStorageUsageBytes(value) {
  const bytes = number(value);
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = Math.round(size * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${units[unitIndex]}`;
}

export function getStorageQuotaTone(quota = {}) {
  if (!quota?.enabled) {
    return 'normal';
  }
  if (number(quota.usedPercent) >= 100 || quota.isExceeded) {
    return 'danger';
  }
  const warningPercent = number(quota.warningPercent) || 80;
  if (number(quota.usedPercent) >= warningPercent || quota.isWarning) {
    return 'warning';
  }
  return 'normal';
}

function buildStatusMessages(usage, quota, tone) {
  const messages = [];
  if (!quota?.enabled) {
    messages.push('配额提醒未启用，仅显示当前统计。');
  } else if (tone === 'danger') {
    messages.push(quota.blockWhenExceeded ? '已超过配额上限，新增媒体保存会被阻断。' : '已超过配额上限；当前仅提醒，不阻断新增媒体保存。');
  } else if (tone === 'warning') {
    messages.push(`已达到 ${quota.warningPercent || 80}% 提醒线。`);
  } else {
    messages.push('当前用量低于提醒线。');
  }
  if (number(usage?.orphanBytes) > 0) {
    messages.push('存在孤儿资源，可前往手动清理候选项确认处理。');
  }
  return messages.join(' ');
}

export function renderStorageUsageCard(payload = {}) {
  const usage = payload?.usage || {};
  const quota = payload?.quota || {};
  const tone = getStorageQuotaTone(quota);
  const card = element(STORAGE_USAGE_IDS.card);
  if (card) {
    card.hidden = false;
    card.dataset.tone = tone;
  }

  setText(STORAGE_USAGE_IDS.total, formatStorageUsageBytes(usage.totalBytes));
  setText(STORAGE_USAGE_IDS.quotaLimit, quota.enabled ? formatStorageUsageBytes(quota.limitBytes) : '未启用');
  setText(STORAGE_USAGE_IDS.percent, quota.enabled ? `${number(quota.usedPercent)}%` : '配额未启用');
  setText(STORAGE_USAGE_IDS.image, formatStorageUsageBytes(bytesOf(usage.byType, 'image')));
  setText(STORAGE_USAGE_IDS.video, formatStorageUsageBytes(bytesOf(usage.byType, 'video')));
  setText(STORAGE_USAGE_IDS.audio, formatStorageUsageBytes(bytesOf(usage.byType, 'audio')));
  setText(STORAGE_USAGE_IDS.file, formatStorageUsageBytes(bytesOf(usage.byType, 'file')));
  setText(STORAGE_USAGE_IDS.local, formatStorageUsageBytes(bytesOf(usage.byStorage, 'local')));
  setText(STORAGE_USAGE_IDS.s3, formatStorageUsageBytes(bytesOf(usage.byStorage, 's3-compatible')));
  setText(STORAGE_USAGE_IDS.orphan, formatStorageUsageBytes(usage.orphanBytes));
  setText(STORAGE_USAGE_IDS.deleted, formatStorageUsageBytes(usage.deletedBytes));
  setText(STORAGE_USAGE_IDS.status, buildStatusMessages(usage, quota, tone));
  setText(
    STORAGE_USAGE_IDS.blockMode,
    quota.blockWhenExceeded ? '超额阻断：已开启，仅拦截新增媒体保存' : '超额阻断：关闭',
  );
}

async function fetchStorageUsage() {
  const response = await fetch('/api/v2/storage/usage', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || '加载存储用量失败');
  }
  return payload;
}

export async function refreshStorageUsageSettings() {
  const card = element(STORAGE_USAGE_IDS.card);
  if (!card) {
    return null;
  }
  try {
    const payload = await fetchStorageUsage();
    renderStorageUsageCard(payload);
    return payload;
  } catch (error) {
    if (card) {
      card.dataset.tone = 'danger';
    }
    setText(STORAGE_USAGE_IDS.status, error?.message || '加载存储用量失败');
    return null;
  }
}

export function initStorageUsageSettings() {
  const card = element(STORAGE_USAGE_IDS.card);
  if (!card || card.__storageUsageBound) {
    return;
  }
  card.__storageUsageBound = true;
  void refreshStorageUsageSettings();
}