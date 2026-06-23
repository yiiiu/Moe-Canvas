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
  s3Metric: 'storageUsageS3CompatibleMetric',
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
    messages.push('空间提醒未启用，目前只展示已占用空间。');
  } else if (tone === 'danger') {
    messages.push(quota.blockWhenExceeded ? '已超过空间上限，新的图片、视频或文件会暂停保存。' : '已超过空间上限；当前只提醒，不会暂停保存。');
  } else if (tone === 'warning') {
    messages.push(`已接近空间上限，达到 ${quota.warningPercent || 80}% 提醒线。`);
  } else {
    messages.push('当前空间充足。');
  }
  if (number(usage?.orphanBytes) > 0) {
    messages.push('有一部分素材未被项目使用，可在清理队列中确认后释放空间。');
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
  setText(STORAGE_USAGE_IDS.quotaLimit, quota.enabled ? formatStorageUsageBytes(quota.limitBytes) : '未设置');
  setText(STORAGE_USAGE_IDS.percent, quota.enabled ? `${number(quota.usedPercent)}%` : '未设置上限');
  setText(STORAGE_USAGE_IDS.image, formatStorageUsageBytes(bytesOf(usage.byType, 'image')));
  setText(STORAGE_USAGE_IDS.video, formatStorageUsageBytes(bytesOf(usage.byType, 'video')));
  setText(STORAGE_USAGE_IDS.audio, formatStorageUsageBytes(bytesOf(usage.byType, 'audio')));
  setText(STORAGE_USAGE_IDS.file, formatStorageUsageBytes(bytesOf(usage.byType, 'file')));
  setText(STORAGE_USAGE_IDS.local, formatStorageUsageBytes(bytesOf(usage.byStorage, 'local')));
  const s3Bytes = bytesOf(usage.byStorage, 's3-compatible');
  setText(STORAGE_USAGE_IDS.s3, formatStorageUsageBytes(s3Bytes));
  const s3Metric = element(STORAGE_USAGE_IDS.s3Metric);
  if (s3Metric) {
    s3Metric.hidden = s3Bytes <= 0;
  }
  setText(STORAGE_USAGE_IDS.orphan, formatStorageUsageBytes(usage.orphanBytes));
  setText(STORAGE_USAGE_IDS.deleted, formatStorageUsageBytes(usage.deletedBytes));
  setText(STORAGE_USAGE_IDS.status, buildStatusMessages(usage, quota, tone));
  setText(
    STORAGE_USAGE_IDS.blockMode,
    quota.blockWhenExceeded ? '空间保护：已开启，超过上限时暂停新增素材保存' : '空间保护：关闭，超过上限时只提醒',
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