import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  __applyAssetRetentionPolicySettings,
  __evaluateAssetRetentionPolicySettings,
  __runAssetRetentionSchedulerNow,
  __saveAssetRetentionPolicySettings,
  __saveAssetRetentionSchedulerSettings,
  normalizeAssetRetentionPolicySettings,
  normalizeAssetRetentionSchedulerSettings,
  readAssetRetentionPolicyForm,
  readAssetRetentionSchedulerForm,
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
    checked: false,
    disabled: false,
    hidden: false,
    textContent: '',
    dataset: {},
    children: [],
    listeners: {},
    className: '',
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
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

test('asset retention settings markup exposes candidate marking but no immediate delete action', () => {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  assert.match(html, /生命周期策略/);
  assert.match(html, /评估可清理资源/);
  assert.match(html, /标记为清理候选/);
  assert.match(html, /当前版本不支持自动删除/);
  assert.doesNotMatch(html, /立即删除/);
});