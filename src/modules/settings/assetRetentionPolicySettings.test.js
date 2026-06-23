import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  __applyAssetRetentionPolicySettings,
  __deleteAssetCleanupQueueSettings,
  __dryRunAssetCleanupQueueSettings,
  __evaluateAssetRetentionPolicySettings,
  __pollAssetCleanupJobSettings,
  __refreshAssetCleanupQueueSettings,
  __rejectAssetCleanupQueueSettings,
  __retryAssetCleanupJobSettings,
  __cancelAssetCleanupJobSettings,
  __runAssetRetentionSchedulerNow,
  __saveAssetRetentionPolicySettings,
  __saveAssetRetentionSchedulerSettings,
  __bindAssetCleanupQueueFilterControls,
  normalizeAssetRetentionPolicySettings,
  normalizeAssetRetentionSchedulerSettings,
  readAssetRetentionPolicyForm,
  readAssetRetentionSchedulerForm,
  renderAssetCleanupQueue,
  renderAssetRetentionPolicyForm,
  renderAssetRetentionSchedulerForm,
  renderAssetRetentionSchedulerRuns,
} from './assetRetentionPolicySettings.js';

function installDocument(elements) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return makeElement('', tagName);
    },
  };
  return () => {
    globalThis.document = previousDocument;
  };
}

function makeElement(value = '', tagName = 'div') {
  return {
    tagName,
    value,
    type: '',
    checked: false,
    disabled: false,
    hidden: false,
    textContent: '',
    dataset: {},
    attributes: {},
    children: [],
    style: {},
    listeners: {},
    className: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      this.children.push(child);
      if (child?.textContent) {
        this.textContent += child.textContent;
      }
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map(child => child?.textContent || '').join('');
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    querySelector(selector) {
      if (selector === '[data-cleanup-result]') {
        return this.children.find(child => child.dataset?.cleanupResult) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[data-asset-id]') {
        return this.children.flatMap(child => {
          if (child.dataset?.assetId && child.tagName === 'input') {
            return [child];
          }
          if (typeof child.querySelectorAll === 'function') {
            return Array.from(child.querySelectorAll(selector));
          }
          return [];
        });
      }
      return [];
    },
  };
}

function makeRetentionElements() {
  return new Map([
    ['assetRetentionEnabled', makeElement()],
    ['assetRetentionOrphanDays', makeElement('7')],
    ['assetRetentionMinAssetAgeHours', makeElement('1')],
    ['assetRetentionDeleteCandidateOnly', makeElement()],
    ['assetRetentionAutoDeleteStatus', makeElement()],
    ['btnAssetRetentionPolicySave', makeElement()],
    ['btnAssetRetentionEvaluate', makeElement()],
    ['btnAssetRetentionApply', makeElement()],
    ['assetRetentionStatus', makeElement()],
    ['assetRetentionCandidateCount', makeElement()],
    ['assetRetentionReclaimable', makeElement()],
    ['assetRetentionCandidateList', makeElement()],
    ['assetRetentionSchedulerEnabled', makeElement()],
    ['assetRetentionSchedulerIntervalHours', makeElement('24')],
    ['assetRetentionSchedulerRunOnStartup', makeElement()],
    ['assetRetentionSchedulerMarkCandidates', makeElement()],
    ['assetRetentionSchedulerAutoDeleteStatus', makeElement()],
    ['assetRetentionSchedulerLastRunAt', makeElement()],
    ['assetRetentionSchedulerNextRunAt', makeElement()],
    ['btnAssetRetentionSchedulerSave', makeElement()],
    ['btnAssetRetentionSchedulerRunNow', makeElement()],
    ['assetRetentionSchedulerStatus', makeElement()],
    ['assetRetentionSchedulerRuns', makeElement()],
    ['assetCleanupQueueCount', makeElement()],
    ['assetCleanupQueueBytes', makeElement()],
    ['assetCleanupQueueByType', makeElement()],
    ['assetCleanupQueueByStorage', makeElement()],
    ['assetCleanupQueueList', makeElement()],
    ['assetCleanupQueueTypeFilter', makeElement('')],
    ['assetCleanupQueueStorageFilter', makeElement('')],
    ['assetCleanupQueueSort', makeElement('size_desc')],
    ['btnAssetCleanupQueueRefresh', makeElement()],
    ['btnAssetCleanupQueueDryRun', makeElement()],
    ['btnAssetCleanupQueueDelete', makeElement()],
    ['btnAssetCleanupQueueReject', makeElement()],
    ['assetCleanupQueueStatus', makeElement()],
    ['assetCleanupJobPanel', makeElement()],
    ['assetCleanupJobTitle', makeElement()],
    ['assetCleanupJobProgress', makeElement()],
    ['assetCleanupJobProgressBar', makeElement()],
    ['assetCleanupJobStats', makeElement()],
    ['assetCleanupJobCurrent', makeElement()],
    ['assetCleanupJobHeartbeat', makeElement()],
    ['assetCleanupJobReport', makeElement()],
    ['btnAssetCleanupJobDetails', makeElement()],
    ['btnAssetCleanupJobCancel', makeElement()],
    ['btnAssetCleanupJobRetry', makeElement()],
    ['storageUsageCard', makeElement()],
    ['storageUsageTotal', makeElement()],
    ['storageUsageQuotaLimit', makeElement()],
    ['storageUsagePercent', makeElement()],
    ['storageUsageTypeImage', makeElement()],
    ['storageUsageTypeVideo', makeElement()],
    ['storageUsageTypeAudio', makeElement()],
    ['storageUsageTypeFile', makeElement()],
    ['storageUsageLocal', makeElement()],
    ['storageUsageS3Compatible', makeElement()],
    ['storageUsageOrphan', makeElement()],
    ['storageUsageDeleted', makeElement()],
    ['storageUsageStatus', makeElement()],
    ['storageUsageBlockMode', makeElement()],
  ]);
}

test('asset retention policy settings normalize to candidate-only and no auto-delete', () => {
  assert.deepEqual(normalizeAssetRetentionPolicySettings({ autoDelete: true, deleteCandidateOnly: false }), {
    enabled: true,
    orphanRetentionDays: 7,
    tempRetentionHours: 24,
    deleteCandidateOnly: true,
    autoDelete: false,
    minAssetAgeHours: 1,
    excludePinned: true,
    excludeRecentlyUsedHours: 24,
  });
});

test('asset retention policy form reads and renders safe fields', () => {
  const elements = makeRetentionElements();
  elements.get('assetRetentionEnabled').checked = true;
  elements.get('assetRetentionOrphanDays').value = '14';
  elements.get('assetRetentionMinAssetAgeHours').value = '2';
  elements.get('assetRetentionDeleteCandidateOnly').checked = true;
  const restore = installDocument(elements);
  try {
    assert.deepEqual(readAssetRetentionPolicyForm(), {
      enabled: true,
      orphanRetentionDays: 14,
      tempRetentionHours: 24,
      deleteCandidateOnly: true,
      autoDelete: false,
      minAssetAgeHours: 2,
      excludePinned: true,
      excludeRecentlyUsedHours: 24,
    });

    renderAssetRetentionPolicyForm({ enabled: false, orphanRetentionDays: 3, minAssetAgeHours: 6, deleteCandidateOnly: false, autoDelete: true });
  } finally {
    restore();
  }

  assert.equal(elements.get('assetRetentionEnabled').checked, false);
  assert.equal(elements.get('assetRetentionOrphanDays').value, '3');
  assert.equal(elements.get('assetRetentionMinAssetAgeHours').value, '6');
  assert.equal(elements.get('assetRetentionDeleteCandidateOnly').checked, true);
  assert.match(elements.get('assetRetentionAutoDeleteStatus').textContent, /当前版本不支持自动删除/);
});

test('asset retention policy save, evaluate and apply use retention endpoints without delete endpoint', async () => {
  const elements = makeRetentionElements();
  elements.get('assetRetentionEnabled').checked = true;
  elements.get('assetRetentionOrphanDays').value = '7';
  elements.get('assetRetentionMinAssetAgeHours').value = '1';
  elements.get('assetRetentionDeleteCandidateOnly').checked = true;
  const restoreDocument = installDocument(elements);
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === '/api/v2/assets/retention/policy' && options.method === 'PUT') {
      return { ok: true, json: async () => ({ success: true, policy: JSON.parse(options.body) }) };
    }
    if (url === '/api/v2/assets/retention/evaluate') {
      return { ok: true, json: async () => ({ success: true, candidates: [{ assetId: 'asset-old', size: 2048 }], candidateCount: 1, reclaimableBytes: 2048 }) };
    }
    if (url === '/api/v2/assets/retention/apply') {
      return { ok: true, json: async () => ({ success: true, marked: [{ assetId: 'asset-old' }], reclaimableBytes: 2048 }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await __saveAssetRetentionPolicySettings();
    await __evaluateAssetRetentionPolicySettings();
    await __applyAssetRetentionPolicySettings();
  } finally {
    restoreDocument();
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(requests.map(request => request.url), [
    '/api/v2/assets/retention/policy',
    '/api/v2/assets/retention/evaluate',
    '/api/v2/assets/retention/apply',
  ]);
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[2].options.method, 'POST');
  assert.doesNotMatch(JSON.stringify(requests), /\/api\/v2\/assets\/delete/);
  assert.match(elements.get('assetRetentionCandidateCount').textContent, /1/);
  assert.match(elements.get('assetRetentionReclaimable').textContent, /2 KB/);
  assert.match(elements.get('assetRetentionStatus').textContent, /已标记 1 个清理候选/);
});

test('asset retention scheduler settings normalize to disabled and never auto-delete', () => {
  assert.deepEqual(normalizeAssetRetentionSchedulerSettings({ intervalHours: 0, autoDelete: true }), {
    enabled: false,
    intervalHours: 1,
    runOnStartup: false,
    markCandidates: true,
    autoDelete: false,
    maxAssetsPerRun: 500,
    lastRunAt: 0,
    nextRunAt: 0,
  });
});

test('asset retention scheduler form reads and renders safe scheduler fields', () => {
  const elements = makeRetentionElements();
  elements.get('assetRetentionSchedulerEnabled').checked = true;
  elements.get('assetRetentionSchedulerIntervalHours').value = '6';
  elements.get('assetRetentionSchedulerRunOnStartup').checked = true;
  elements.get('assetRetentionSchedulerMarkCandidates').checked = true;
  const restore = installDocument(elements);
  try {
    assert.deepEqual(readAssetRetentionSchedulerForm(), {
      enabled: true,
      intervalHours: 6,
      runOnStartup: true,
      markCandidates: true,
      autoDelete: false,
      maxAssetsPerRun: 500,
      lastRunAt: 0,
      nextRunAt: 0,
    });

    renderAssetRetentionSchedulerForm({
      enabled: false,
      intervalHours: 12,
      runOnStartup: false,
      markCandidates: true,
      autoDelete: true,
      lastRunAt: 1710000000000,
      nextRunAt: 1710086400000,
    });
  } finally {
    restore();
  }

  assert.equal(elements.get('assetRetentionSchedulerEnabled').checked, false);
  assert.equal(elements.get('assetRetentionSchedulerIntervalHours').value, '12');
  assert.equal(elements.get('assetRetentionSchedulerRunOnStartup').checked, false);
  assert.equal(elements.get('assetRetentionSchedulerMarkCandidates').checked, true);
  assert.match(elements.get('assetRetentionSchedulerAutoDeleteStatus').textContent, /不支持|已禁用/);
  assert.notEqual(elements.get('assetRetentionSchedulerLastRunAt').textContent, '从未运行');
  assert.notEqual(elements.get('assetRetentionSchedulerNextRunAt').textContent, '未计划');
});

test('asset retention scheduler save and run use scheduler endpoints without delete endpoint', async () => {
  const elements = makeRetentionElements();
  elements.get('assetRetentionSchedulerEnabled').checked = true;
  elements.get('assetRetentionSchedulerIntervalHours').value = '8';
  elements.get('assetRetentionSchedulerRunOnStartup').checked = true;
  elements.get('assetRetentionSchedulerMarkCandidates').checked = true;
  const restoreDocument = installDocument(elements);
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url === '/api/v2/assets/retention/scheduler' && options.method === 'PUT') {
      return { ok: true, json: async () => ({ success: true, scheduler: JSON.parse(options.body), warnings: [] }) };
    }
    if (url === '/api/v2/assets/retention/scheduler/run') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          run: { status: 'success', candidateCount: 2, markedCount: 2, candidateBytes: 4096 },
          scheduler: { enabled: true, intervalHours: 8, lastRunAt: 1710000000000, nextRunAt: 1710028800000 },
        }),
      };
    }
    if (url === '/api/v2/assets/retention/scheduler/runs') {
      return { ok: true, json: async () => ({ success: true, runs: [{ runId: 'run-1', status: 'success', markedCount: 2 }] }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await __saveAssetRetentionSchedulerSettings();
    await __runAssetRetentionSchedulerNow();
  } finally {
    restoreDocument();
    globalThis.fetch = previousFetch;
  }

  assert.deepEqual(requests.map(request => request.url), [
    '/api/v2/assets/retention/scheduler',
    '/api/v2/assets/retention/scheduler/run',
    '/api/v2/assets/retention/scheduler/runs',
  ]);
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(JSON.parse(requests[1].options.body).dryRun, false);
  assert.doesNotMatch(JSON.stringify(requests), /\/api\/v2\/assets\/delete/);
  assert.match(elements.get('assetRetentionSchedulerStatus').textContent, /已完成|已标记/);
});

test('asset retention scheduler runs render recent run records', () => {
  const elements = makeRetentionElements();
  const restore = installDocument(elements);
  try {
    renderAssetRetentionSchedulerRuns([
      { runId: 'run-1', status: 'success', mode: 'manual', candidateCount: 2, markedCount: 1, candidateBytes: 1024 },
    ]);
  } finally {
    restore();
  }

  assert.equal(elements.get('assetRetentionSchedulerRuns').hidden, false);
  assert.equal(elements.get('assetRetentionSchedulerRuns').children.length, 1);
  assert.match(elements.get('assetRetentionSchedulerRuns').children[0].textContent, /manual/);
  assert.match(elements.get('assetRetentionSchedulerRuns').children[0].textContent, /标记 1/);
});

test('asset cleanup queue renders summary, selectable items and blocked dry-run results', () => {
  const elements = makeRetentionElements();
  const restore = installDocument(elements);
  try {
    renderAssetCleanupQueue({
      queue: [
        { assetId: 'asset-a', type: 'image', size: 2048, storage: { type: 'local', bucket: '' }, usage: { usageCount: 0 }, pinned: false },
        { assetId: 'asset-b', type: 'video', size: 4096, storage: { type: 's3-compatible', bucket: 'safe' }, usage: { usageCount: 0 }, pinned: true },
      ],
      summary: {
        totalCount: 2,
        totalBytes: 6144,
        byType: { image: { count: 1, bytes: 2048 }, video: { count: 1, bytes: 4096 } },
        byStorage: { local: { count: 1, bytes: 2048 }, 's3-compatible': { count: 1, bytes: 4096 } },
      },
    });
    renderAssetCleanupQueue({
      dryRunResults: [
        { assetId: 'asset-a', canDelete: true, releasableBytes: 2048, reason: 'orphan_asset' },
        { assetId: 'asset-b', canDelete: false, releasableBytes: 0, reason: 'asset_pinned' },
      ],
    });
  } finally {
    restore();
  }

  assert.equal(elements.get('assetCleanupQueueCount').textContent, '2');
  assert.match(elements.get('assetCleanupQueueBytes').textContent, /6 KB/);
  assert.match(elements.get('assetCleanupQueueByType').textContent, /image/);
  assert.match(elements.get('assetCleanupQueueByStorage').textContent, /s3-compatible/);
  assert.equal(elements.get('assetCleanupQueueList').children.length, 2);
  assert.match(elements.get('assetCleanupQueueList').children[1].textContent, /asset-b/);
  assert.match(elements.get('assetCleanupQueueList').children[1].textContent, /asset_pinned|pinned/);
});

test('asset cleanup queue actions create background cleanup job and render progress report', async () => {
  const elements = makeRetentionElements();
  const restoreDocument = installDocument(elements);
  const previousFetch = globalThis.fetch;
  const previousConfirm = globalThis.confirm;
  const requests = [];
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url.startsWith('/api/v2/assets/cleanup-queue?')) {
      return { ok: true, json: async () => ({ success: true, queue: [{ assetId: 'asset-a', size: 2048, storage: { type: 'local' }, usage: { usageCount: 0 } }], summary: { totalCount: 1, totalBytes: 2048, byType: {}, byStorage: {} } }) };
    }
    if (url === '/api/v2/assets/cleanup-queue/dry-run') {
      return { ok: true, json: async () => ({ success: true, results: [{ assetId: 'asset-a', canDelete: true, releasableBytes: 2048, reason: 'orphan_asset' }] }) };
    }
    if (url === '/api/v2/assets/cleanup-jobs') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          cleanupJobId: 'cleanup-job-1',
          job: { cleanupJobId: 'cleanup-job-1', status: 'pending', totalCount: 1, processedCount: 0, progressPercent: 0, lastHeartbeatAt: 1710000000000, results: [{ assetId: 'asset-a', status: 'pending', reason: 'pending' }] },
        }),
      };
    }
    if (url === '/api/v2/assets/cleanup-jobs/cleanup-job-1') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          job: {
            cleanupJobId: 'cleanup-job-1',
            status: 'partial_failed',
            totalCount: 2,
            processedCount: 2,
            successCount: 1,
            failedCount: 1,
            skippedCount: 0,
            releasedBytes: 2048,
            currentAssetId: '',
            progressPercent: 100,
            lastHeartbeatAt: 1710000001000,
            results: [
              { assetId: 'asset-a', status: 'success', reason: 'orphan_asset', releasedBytes: 2048 },
              { assetId: 'asset-b', status: 'failed', reason: 'delete_failed', error: 'safe error' },
            ],
          },
        }),
      };
    }
    if (url === '/api/v2/assets/cleanup-jobs/cleanup-job-1/cancel') {
      return { ok: true, json: async () => ({ success: true, job: { cleanupJobId: 'cleanup-job-1', status: 'canceled', totalCount: 1, processedCount: 1, progressPercent: 100, lastHeartbeatAt: 1710000002000, results: [{ assetId: 'asset-a', status: 'skipped', reason: 'canceled' }] } }) };
    }
    if (url === '/api/v2/assets/cleanup-jobs/cleanup-job-1/retry') {
      return { ok: true, json: async () => ({ success: true, job: { cleanupJobId: 'cleanup-job-1', status: 'success', totalCount: 2, processedCount: 2, successCount: 2, failedCount: 0, skippedCount: 0, releasedBytes: 2048, progressPercent: 100, lastHeartbeatAt: 1710000003000, results: [{ assetId: 'asset-b', status: 'success', reason: 'retry_delete_failed', attempts: [{ status: 'failed' }, { status: 'success' }] }] } }) };
    }
    if (url === '/api/v2/assets/cleanup-queue/reject') {
      return { ok: true, json: async () => ({ success: true, results: [{ assetId: 'asset-a', rejected: true, reason: 'rejected' }] }) };
    }
    if (url === '/api/v2/storage/usage') {
      return { ok: true, json: async () => ({ success: true, usage: { totalBytes: 0, byType: {}, byStorage: {} }, quota: { enabled: false } }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await __refreshAssetCleanupQueueSettings();
    elements.get('assetCleanupQueueList').querySelectorAll('input[data-asset-id]').forEach(input => {
      input.checked = true;
    });
    await __dryRunAssetCleanupQueueSettings();
    await __deleteAssetCleanupQueueSettings();
    await __pollAssetCleanupJobSettings('cleanup-job-1');
    await __cancelAssetCleanupJobSettings('cleanup-job-1');
    await __retryAssetCleanupJobSettings('cleanup-job-1');
    elements.get('assetCleanupQueueList').querySelectorAll('input[data-asset-id]').forEach(input => {
      input.checked = true;
    });
    await __rejectAssetCleanupQueueSettings();
  } finally {
    restoreDocument();
    globalThis.fetch = previousFetch;
    globalThis.confirm = previousConfirm;
  }

  assert.deepEqual(requests.map(request => request.url), [
    '/api/v2/assets/cleanup-queue?sort=size_desc&page=1&pageSize=50',
    '/api/v2/assets/cleanup-queue/dry-run',
    '/api/v2/assets/cleanup-jobs',
    '/api/v2/assets/cleanup-jobs/cleanup-job-1',
    '/api/v2/assets/cleanup-queue?sort=size_desc&page=1&pageSize=50',
    '/api/v2/storage/usage',
    '/api/v2/assets/cleanup-jobs/cleanup-job-1/cancel',
    '/api/v2/assets/cleanup-jobs/cleanup-job-1/retry',
    '/api/v2/assets/cleanup-queue/reject',
    '/api/v2/assets/cleanup-queue?sort=size_desc&page=1&pageSize=50',
  ]);
  assert.equal(JSON.parse(requests[2].options.body).confirm, true);
  assert.deepEqual(JSON.parse(requests[2].options.body).assetIds, ['asset-a']);
  assert.doesNotMatch(JSON.stringify(requests), /cleanup-queue\/delete/);
  assert.doesNotMatch(JSON.stringify(requests), /\/api\/v2\/assets\/delete/);
  assert.match(elements.get('assetCleanupQueueStatus').textContent, /后台清理任务|已拒绝/);
  assert.match(elements.get('assetCleanupJobTitle').textContent, /已清理 2 项/);
  assert.match(elements.get('assetCleanupJobProgress').textContent, /100%/);
  assert.equal(elements.get('assetCleanupJobProgressBar').style.width, '100%');
  assert.match(elements.get('assetCleanupJobStats').textContent, /释放 2 KB/);
  assert.equal(elements.get('assetCleanupJobReport').hidden, true);
  assert.equal(elements.get('btnAssetCleanupJobDetails').hidden, false);
  assert.match(elements.get('btnAssetCleanupJobDetails').textContent, /查看清理详情/);
  const restoreDetailsDocument = installDocument(elements);
  try {
    await elements.get('btnAssetCleanupJobDetails').listeners.click();
  } finally {
    restoreDetailsDocument();
  }
  assert.equal(elements.get('assetCleanupJobReport').hidden, false);
  assert.match(elements.get('assetCleanupJobReport').textContent, /retry_delete_failed/);
});

test('asset cleanup queue custom filter control updates hidden value and refreshes queue', async () => {
  const elements = makeRetentionElements();
  const typeValue = elements.get('assetCleanupQueueTypeFilter');
  const typeText = makeElement('全部');
  const videoOption = makeElement('video');
  videoOption.dataset.value = 'video';
  const customSelect = makeElement('', 'div');
  customSelect.dataset.cleanupQueueSelect = 'assetCleanupQueueTypeFilter';
  customSelect.children = [typeText, videoOption];
  customSelect.querySelector = selector => {
    if (selector === '[data-cleanup-queue-select-value]') {
      return typeText;
    }
    return null;
  };
  customSelect.querySelectorAll = selector => {
    if (selector === '[data-cleanup-queue-option]') {
      return [videoOption];
    }
    return [];
  };
  const restoreDocument = installDocument(elements);
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (url.startsWith('/api/v2/assets/cleanup-queue?')) {
      return { ok: true, json: async () => ({ success: true, queue: [], summary: { totalCount: 0, totalBytes: 0, byType: {}, byStorage: {} } }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    __bindAssetCleanupQueueFilterControls([customSelect]);
    await videoOption.listeners.click();
  } finally {
    restoreDocument();
    globalThis.fetch = previousFetch;
  }

  assert.equal(typeValue.value, 'video');
  assert.equal(typeText.textContent, 'video');
  assert.deepEqual(requests.map(request => request.url), [
    '/api/v2/assets/cleanup-queue?type=video&sort=size_desc&page=1&pageSize=50',
  ]);
});

test('asset retention settings markup uses custom cleanup queue dropdowns instead of native selects', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const cleanupQueueMarkup = html.slice(
    html.indexOf('id="assetCleanupQueueSettingsForm"'),
    html.indexOf('id="assetCleanupQueueStatus"'),
  );

  assert.doesNotMatch(cleanupQueueMarkup, /<select\b/);
  assert.match(cleanupQueueMarkup, /data-cleanup-queue-select="assetCleanupQueueTypeFilter"/);
  assert.match(cleanupQueueMarkup, /data-cleanup-queue-option/);
});

test('asset cleanup queue dropdown trigger follows settings save button theme style', () => {
  for (const cssPath of ['style.css', 'styles/settings.css']) {
    const css = readFileSync(join(process.cwd(), cssPath), 'utf8');
    const triggerRule = css.match(/\.settings-cleanup-select-trigger\s*\{([\s\S]*?)\}/);
    const hoverRule = css.match(/\.settings-cleanup-select-trigger:hover\s*\{([\s\S]*?)\}/);

    assert.ok(triggerRule, `${cssPath} should define cleanup dropdown trigger style`);
    assert.ok(hoverRule, `${cssPath} should define cleanup dropdown trigger hover style`);
    assert.match(triggerRule[1], /border:\s*1px solid var\(--settings-save-btn-border/);
    assert.match(triggerRule[1], /background:\s*var\(--settings-save-btn-bg/);
    assert.match(triggerRule[1], /color:\s*var\(--settings-save-btn-color/);
    assert.match(hoverRule[1], /border-color:\s*var\(--settings-save-btn-border-hover/);
    assert.match(hoverRule[1], /background:\s*var\(--settings-save-btn-bg-hover/);
    assert.match(hoverRule[1], /color:\s*var\(--settings-save-btn-color-hover/);
    assert.doesNotMatch(triggerRule[1], /linear-gradient/);
    assert.doesNotMatch(triggerRule[1], /rgba\(38, 24, 34/);
  }
});

test('asset cleanup job progress fill uses a solid available theme color', () => {
  for (const cssPath of ['style.css', 'styles/settings.css']) {
    const css = readFileSync(join(process.cwd(), cssPath), 'utf8');
    const fillRule = css.match(/\.settings-cleanup-job-track span\s*\{([\s\S]*?)\}/);

    assert.ok(fillRule, `${cssPath} should define cleanup job progress fill style`);
    assert.match(fillRule[1], /background:\s*var\(--blue\);/);
    assert.doesNotMatch(fillRule[1], /linear-gradient/);
    assert.doesNotMatch(fillRule[1], /var\(--primary\)/);
  }
});

test('asset retention settings markup exposes candidate marking and cleanup queue review actions', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  assert.match(html, /生命周期策略/);
  assert.match(html, /评估可清理资源/);
  assert.match(html, /标记为清理候选/);
  assert.match(html, /清理队列/);
  assert.match(html, /删除后将移除 MinIO\/S3\/本地文件，但保留 AssetRecord 审计/);
  assert.match(html, /确认删除所选/);
  assert.match(html, /拒绝清理所选/);
  assert.match(html, /当前版本不支持自动删除/);
});
