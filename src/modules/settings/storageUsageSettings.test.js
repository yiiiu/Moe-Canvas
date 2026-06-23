import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  formatStorageUsageBytes,
  getStorageQuotaTone,
  renderStorageUsageCard,
} from './storageUsageSettings.js';

test('storage usage bytes are formatted for settings display', () => {
  assert.equal(formatStorageUsageBytes(0), '0 B');
  assert.equal(formatStorageUsageBytes(1024), '1 KB');
  assert.equal(formatStorageUsageBytes(1536), '1.5 KB');
  assert.equal(formatStorageUsageBytes(1024 * 1024 * 2), '2 MB');
});

test('storage quota tone follows warning and exceeded thresholds', () => {
  assert.equal(getStorageQuotaTone({ enabled: false, usedPercent: 200, warningPercent: 80 }), 'normal');
  assert.equal(getStorageQuotaTone({ enabled: true, usedPercent: 79, warningPercent: 80 }), 'normal');
  assert.equal(getStorageQuotaTone({ enabled: true, usedPercent: 80, warningPercent: 80 }), 'warning');
  assert.equal(getStorageQuotaTone({ enabled: true, usedPercent: 100, warningPercent: 80 }), 'danger');
});

test('storage usage card shows user-facing labels without storage jargon', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const cardMatch = html.match(/<div\s+class="settings-section settings-card settings-storage-usage-card"[\s\S]*?<div class="settings-storage-quota-form"/);
  assert.ok(cardMatch, 'storage usage card markup should exist');
  const cardHtml = cardMatch[0];

  assert.match(cardHtml, /应用保存记录/);
  assert.match(cardHtml, /云端存储/);
  assert.match(cardHtml, /可清理空间/);
  assert.match(cardHtml, /清理记录/);
  assert.match(cardHtml, /未设置上限/);
  assert.doesNotMatch(cardHtml, /Asset Registry/);
  assert.doesNotMatch(cardHtml, /S3-compatible/);
  assert.doesNotMatch(cardHtml, /孤儿资源/);
  assert.doesNotMatch(cardHtml, /已删除记录/);
  assert.doesNotMatch(cardHtml, /汇总本机与云端保存的素材占用/);
});

test('storage usage warning tone does not tint the whole settings card', () => {
  const css = readFileSync(new URL('../../../style.css', import.meta.url), 'utf8');
  const fullCardToneRules = [...css.matchAll(/\.settings-storage-usage-card\[data-tone="(?:warning|danger)"\]\s*\{([\s\S]*?)\}/g)];

  for (const [, body] of fullCardToneRules) {
    assert.doesNotMatch(body, /\bbackground\s*:/);
    assert.doesNotMatch(body, /\bborder-color\s*:/);
  }
  assert.match(css, /\.settings-storage-usage-card\[data-tone="danger"\]\s+\.settings-storage-usage-status/);
});

test('storage usage card renders totals, quota, storage backends and orphan reminder', () => {
  const elements = new Map();
  const makeElement = () => ({ textContent: '', hidden: false, dataset: {}, className: '', classList: { toggle() {} } });
  for (const id of [
    'storageUsageCard',
    'storageUsageTotal',
    'storageUsageQuotaLimit',
    'storageUsagePercent',
    'storageUsageTypeImage',
    'storageUsageTypeVideo',
    'storageUsageTypeAudio',
    'storageUsageTypeFile',
    'storageUsageLocal',
    'storageUsageS3Compatible',
    'storageUsageOrphan',
    'storageUsageDeleted',
    'storageUsageStatus',
    'storageUsageBlockMode',
  ]) {
    elements.set(id, makeElement());
  }
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: id => elements.get(id) || null };
  try {
    renderStorageUsageCard({
      success: true,
      usage: {
        totalBytes: 110,
        orphanBytes: 30,
        deletedBytes: 20,
        byType: {
          image: { bytes: 10 },
          video: { bytes: 20 },
          audio: { bytes: 30 },
          file: { bytes: 50 },
        },
        byStorage: {
          local: { bytes: 80 },
          's3-compatible': { bytes: 30 },
        },
      },
      quota: {
        enabled: true,
        limitBytes: 100,
        usedPercent: 110,
        warningPercent: 80,
        isWarning: true,
        isExceeded: true,
        blockWhenExceeded: true,
      },
    });
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(elements.get('storageUsageCard').dataset.tone, 'danger');
  assert.equal(elements.get('storageUsageTotal').textContent, '110 B');
  assert.equal(elements.get('storageUsageQuotaLimit').textContent, '100 B');
  assert.equal(elements.get('storageUsagePercent').textContent, '110%');
  assert.equal(elements.get('storageUsageTypeImage').textContent, '10 B');
  assert.equal(elements.get('storageUsageTypeVideo').textContent, '20 B');
  assert.equal(elements.get('storageUsageTypeAudio').textContent, '30 B');
  assert.equal(elements.get('storageUsageTypeFile').textContent, '50 B');
  assert.equal(elements.get('storageUsageLocal').textContent, '80 B');
  assert.equal(elements.get('storageUsageS3Compatible').textContent, '30 B');
  assert.equal(elements.get('storageUsageOrphan').textContent, '30 B');
  assert.equal(elements.get('storageUsageDeleted').textContent, '20 B');
  assert.match(elements.get('storageUsageStatus').textContent, /已超过空间上限/);
  assert.match(elements.get('storageUsageStatus').textContent, /新的图片、视频或文件会暂停保存/);
  assert.match(elements.get('storageUsageStatus').textContent, /素材未被项目使用/);
  assert.match(elements.get('storageUsageBlockMode').textContent, /已开启/);
});

test('storage usage card hides cloud metric when there is no cloud usage', () => {
  const elements = new Map();
  const makeElement = () => ({ textContent: '', hidden: false, dataset: {}, className: '', classList: { toggle() {} } });
  for (const id of [
    'storageUsageCard',
    'storageUsageTotal',
    'storageUsageQuotaLimit',
    'storageUsagePercent',
    'storageUsageTypeImage',
    'storageUsageTypeVideo',
    'storageUsageTypeAudio',
    'storageUsageTypeFile',
    'storageUsageLocal',
    'storageUsageS3Compatible',
    'storageUsageS3CompatibleMetric',
    'storageUsageOrphan',
    'storageUsageDeleted',
    'storageUsageStatus',
    'storageUsageBlockMode',
  ]) {
    elements.set(id, makeElement());
  }
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: id => elements.get(id) || null };
  try {
    renderStorageUsageCard({
      success: true,
      usage: {
        totalBytes: 1024,
        orphanBytes: 0,
        deletedBytes: 0,
        byType: {},
        byStorage: { local: { bytes: 1024 } },
      },
      quota: { enabled: false, blockWhenExceeded: false },
    });
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(elements.get('storageUsageS3CompatibleMetric').hidden, true);
  assert.equal(elements.get('storageUsageS3Compatible').textContent, '0 B');
});

test('storage usage card shows clear disabled quota label instead of dash', () => {
  const elements = new Map();
  const makeElement = () => ({ textContent: '', hidden: false, dataset: {}, className: '', classList: { toggle() {} } });
  for (const id of [
    'storageUsageCard',
    'storageUsageTotal',
    'storageUsageQuotaLimit',
    'storageUsagePercent',
    'storageUsageTypeImage',
    'storageUsageTypeVideo',
    'storageUsageTypeAudio',
    'storageUsageTypeFile',
    'storageUsageLocal',
    'storageUsageS3Compatible',
    'storageUsageOrphan',
    'storageUsageDeleted',
    'storageUsageStatus',
    'storageUsageBlockMode',
  ]) {
    elements.set(id, makeElement());
  }
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: id => elements.get(id) || null };
  try {
    renderStorageUsageCard({
      success: true,
      usage: {
        totalBytes: 1024,
        orphanBytes: 1024,
        deletedBytes: 0,
        byType: {},
        byStorage: {},
      },
      quota: {
        enabled: false,
        limitBytes: 0,
        usedPercent: 0,
        warningPercent: 80,
        isWarning: false,
        isExceeded: false,
        blockWhenExceeded: false,
      },
    });
  } finally {
    globalThis.document = previousDocument;
  }

  assert.equal(elements.get('storageUsageCard').dataset.tone, 'normal');
  assert.equal(elements.get('storageUsageQuotaLimit').textContent, '未设置');
  assert.equal(elements.get('storageUsagePercent').textContent, '未设置上限');
  assert.match(elements.get('storageUsageStatus').textContent, /只展示已占用空间/);
  assert.match(elements.get('storageUsageStatus').textContent, /素材未被项目使用/);
});