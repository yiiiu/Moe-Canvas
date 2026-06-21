import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageQuotaSettings,
  formatStorageQuotaExceededMessage,
  normalizeStorageQuotaSettings,
  renderStorageQuotaSettingsForm,
  readStorageQuotaSettingsForm,
  __saveStorageQuotaSettings,
} from './storageQuotaSettings.js';

function installDocument(elements) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  return () => {
    globalThis.document = previousDocument;
  };
}

function makeInput(value = '', checked = false) {
  return {
    value,
    checked,
    disabled: false,
    textContent: '',
    dataset: {},
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
}

test('storage quota settings normalize blockWhenExceeded default to false', () => {
  assert.deepEqual(normalizeStorageQuotaSettings({}), {
    enabled: false,
    limitBytes: 0,
    warningPercent: 80,
    blockWhenExceeded: false,
  });
  assert.deepEqual(
    normalizeStorageQuotaSettings({ enabled: true, limitBytes: 1024, warningPercent: 90, blockWhenExceeded: true }),
    { enabled: true, limitBytes: 1024, warningPercent: 90, blockWhenExceeded: true },
  );
});

test('storage quota settings merge without dropping existing settings', () => {
  const merged = buildStorageQuotaSettings(
    { theme: 'dark', customStorage: { enabled: true }, storageQuota: { enabled: false } },
    { enabled: true, limitBytes: 2048, warningPercent: 75, blockWhenExceeded: true },
  );

  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.customStorage, { enabled: true });
  assert.deepEqual(merged.storageQuota, {
    enabled: true,
    limitBytes: 2048,
    warningPercent: 75,
    blockWhenExceeded: true,
  });
});

test('storage quota form reads and renders blockWhenExceeded switch', () => {
  const elements = new Map([
    ['storageQuotaEnabled', makeInput('', true)],
    ['storageQuotaLimitGB', makeInput('2')],
    ['storageQuotaWarningPercent', makeInput('80')],
    ['storageQuotaBlockWhenExceeded', makeInput('', true)],
  ]);
  const restore = installDocument(elements);
  try {
    assert.deepEqual(readStorageQuotaSettingsForm(), {
      enabled: true,
      limitBytes: 2147483648,
      warningPercent: 80,
      blockWhenExceeded: true,
    });

    renderStorageQuotaSettingsForm({ enabled: false, limitBytes: 1073741824, warningPercent: 70, blockWhenExceeded: false });
  } finally {
    restore();
  }

  assert.equal(elements.get('storageQuotaEnabled').checked, false);
  assert.equal(elements.get('storageQuotaLimitGB').value, '1');
  assert.equal(elements.get('storageQuotaWarningPercent').value, '70');
  assert.equal(elements.get('storageQuotaBlockWhenExceeded').checked, false);
});

test('storage quota save persists blockWhenExceeded and keeps unrelated settings', async () => {
  const elements = new Map([
    ['storageQuotaEnabled', makeInput('', true)],
    ['storageQuotaLimitGB', makeInput('3')],
    ['storageQuotaWarningPercent', makeInput('85')],
    ['storageQuotaBlockWhenExceeded', makeInput('', true)],
    ['btnStorageQuotaSave', makeInput()],
    ['storageQuotaSettingsStatus', makeInput()],
  ]);
  const restoreDocument = installDocument(elements);
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (String(url) === '/api/v2/user/settings.json' && (!options.method || options.method === 'GET')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ theme: 'dark', customStorage: { enabled: false } }),
        text: async () => JSON.stringify({ theme: 'dark', customStorage: { enabled: false } }),
      };
    }
    if (String(url) === '/api/v2/user/settings.json' && options.method === 'POST') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    await __saveStorageQuotaSettings();
  } finally {
    restoreDocument();
    globalThis.fetch = previousFetch;
  }

  const saved = JSON.parse(requests[1].options.body);
  assert.equal(saved.theme, 'dark');
  assert.deepEqual(saved.customStorage, { enabled: false });
  assert.deepEqual(saved.storageQuota, {
    enabled: true,
    limitBytes: 3221225472,
    warningPercent: 85,
    blockWhenExceeded: true,
  });
});

test('storage quota exceeded formatter returns explicit storage space message', () => {
  const message = formatStorageQuotaExceededMessage({
    message: 'storage_quota_exceeded: 存储空间不足，无法保存。本次需要 12 MB，当前已用 1 GB / 1 GB。',
  });

  assert.match(message, /存储空间不足，无法保存/);
  assert.match(message, /本次需要 12 MB/);
  assert.doesNotMatch(message, /MinIO|上传失败|通用保存失败/);
});