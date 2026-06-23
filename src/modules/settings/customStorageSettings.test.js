import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildCustomStorageSettings,
  normalizeCustomStorageSettings,
  sanitizeStorageErrorMessage,
  bindSecretVisibilityToggles,
  renderCustomStorageSettingsForm,
  initCustomStorageSettings,
  __testCustomStorage,
} from './customStorageSettings.js';

test('custom storage settings default to disabled s3-compatible bucket shape', () => {
  const normalized = normalizeCustomStorageSettings({});

  assert.deepEqual(normalized, {
    enabled: false,
    activeBucketId: '',
    buckets: [],
  });
});

test('custom storage settings normalize one active s3-compatible bucket', () => {
  const normalized = normalizeCustomStorageSettings({
    enabled: true,
    activeBucketId: 'bucket-custom',
    buckets: [
      {
        id: 'bucket-custom',
        label: '  我的 R2  ',
        providerType: 'r2',
        endpoint: ' https://account.r2.cloudflarestorage.com ',
        region: '',
        bucket: ' ai-canvas-assets ',
        accessKeyId: ' key-id ',
        secretAccessKey: ' secret-key ',
        forcePathStyle: true,
        publicBaseUrl: ' https://cdn.example.com/assets/ ',
        prefix: ' /ai-canvas// ',
        enabled: true,
      },
    ],
  });

  assert.deepEqual(normalized, {
    enabled: true,
    activeBucketId: 'bucket-custom',
    buckets: [
      {
        id: 'bucket-custom',
        label: '我的 R2',
        providerType: 's3-compatible',
        endpoint: 'https://account.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'ai-canvas-assets',
        accessKeyId: 'key-id',
        secretAccessKey: 'secret-key',
        forcePathStyle: true,
        publicBaseUrl: 'https://cdn.example.com/assets',
        prefix: 'ai-canvas/',
        enabled: true,
      },
    ],
  });
});

test('custom storage settings merge into existing user settings without dropping other keys', () => {
  const merged = buildCustomStorageSettings(
    {
      theme: 'dark',
      fileSavePaths: { outputDir: 'D:/output' },
      storageQuota: { enabled: true, limitBytes: 2147483648, warningPercent: 80, blockWhenExceeded: false },
      customStorage: { enabled: false, activeBucketId: '', buckets: [] },
    },
    {
      enabled: true,
      activeBucketId: 'bucket-main',
      buckets: [
        {
          id: 'bucket-main',
          label: 'MinIO',
          endpoint: 'http://127.0.0.1:9000',
          region: 'us-east-1',
          bucket: 'canvas',
          accessKeyId: 'minio-user',
          secretAccessKey: 'minio-secret',
          forcePathStyle: true,
          publicBaseUrl: 'http://127.0.0.1:9000/canvas',
          prefix: 'media',
          enabled: true,
        },
      ],
    },
  );

  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.fileSavePaths, { outputDir: 'D:/output' });
  assert.deepEqual(merged.storageQuota, { enabled: true, limitBytes: 2147483648, warningPercent: 80, blockWhenExceeded: false });
  assert.equal(merged.customStorage.enabled, true);
  assert.equal(merged.customStorage.buckets[0].providerType, 's3-compatible');
  assert.equal(merged.customStorage.buckets[0].prefix, 'media/');
});

test('custom storage form collapses bucket fields when cloud storage is disabled', () => {
  const elements = new Map();
  const makeInput = (value = '', checked = false) => ({ value, checked, hidden: false, disabled: false, textContent: '', dataset: {} });
  const makePanel = () => ({ hidden: false, dataset: {}, textContent: '' });
  elements.set('customStorageEnabled', makeInput('', false));
  elements.set('customStorageFieldsPanel', makePanel());
  elements.set('customStorageDisabledHint', makePanel());
  elements.set('customStorageLabel', makeInput('MinIO'));
  elements.set('customStorageEndpoint', makeInput('http://127.0.0.1:9000'));
  elements.set('customStorageRegion', makeInput('us-east-1'));
  elements.set('customStorageBucket', makeInput('canvas-assets'));
  elements.set('customStorageAccessKeyId', makeInput('minio-user'));
  elements.set('customStorageSecretAccessKey', makeInput('minio-secret'));
  elements.set('customStorageForcePathStyle', makeInput('', true));
  elements.set('customStoragePublicBaseUrl', makeInput('http://public.example.com/assets'));
  elements.set('customStoragePrefix', makeInput('ai-canvas/'));
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: id => elements.get(id) || null };
  try {
    renderCustomStorageSettingsForm({ enabled: false, buckets: [] });
    assert.equal(elements.get('customStorageFieldsPanel').hidden, true);
    assert.equal(elements.get('customStorageDisabledHint').hidden, false);
    assert.match(elements.get('customStorageDisabledHint').textContent, /启用云端存储后再配置/);

    renderCustomStorageSettingsForm({
      enabled: true,
      activeBucketId: 'bucket-main',
      buckets: [{ id: 'bucket-main', label: 'MinIO', endpoint: 'http://127.0.0.1:9000', bucket: 'canvas-assets', accessKeyId: 'minio-user', secretAccessKey: 'minio-secret' }],
    });
    assert.equal(elements.get('customStorageFieldsPanel').hidden, false);
    assert.equal(elements.get('customStorageDisabledHint').hidden, true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('custom storage enable switch saves immediately without clicking save bucket', async () => {
  const elements = new Map();
  const makeInput = (value = '', checked = false) => ({
    value,
    checked,
    hidden: false,
    disabled: false,
    textContent: '',
    dataset: {},
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  });
  const makePanel = () => ({ hidden: false, dataset: {}, textContent: '' });
  elements.set('customStorageEnabled', makeInput('', false));
  elements.set('customStorageFieldsPanel', makePanel());
  elements.set('customStorageDisabledHint', makePanel());
  elements.set('customStorageLabel', makeInput('MinIO'));
  elements.set('customStorageEndpoint', makeInput('http://127.0.0.1:9000'));
  elements.set('customStorageRegion', makeInput('us-east-1'));
  elements.set('customStorageBucket', makeInput('canvas-assets'));
  elements.set('customStorageAccessKeyId', makeInput('minio-user'));
  elements.set('customStorageSecretAccessKey', makeInput('minio-secret'));
  elements.set('customStorageForcePathStyle', makeInput('', true));
  elements.set('customStoragePublicBaseUrl', makeInput('http://public.example.com/assets'));
  elements.set('customStoragePrefix', makeInput('ai-canvas/'));
  elements.set('btnCustomStorageSave', makeInput());
  elements.set('btnCustomStorageTest', makeInput());
  elements.set('customStorageStatus', makePanel());
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requests = [];
  const existingSettings = {
    theme: 'dark',
    customStorage: {
      enabled: false,
      activeBucketId: 'bucket_default',
      buckets: [{
        id: 'bucket_default',
        label: 'MinIO',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        bucket: 'canvas-assets',
        accessKeyId: 'minio-user',
        secretAccessKey: 'minio-secret',
        forcePathStyle: true,
        publicBaseUrl: 'http://public.example.com/assets',
        prefix: 'ai-canvas/',
        enabled: true,
      }],
    },
  };
  globalThis.document = { getElementById: id => elements.get(id) || null };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (!options.method || options.method === 'GET') {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => existingSettings };
    }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => JSON.parse(options.body) };
  };
  try {
    initCustomStorageSettings();
    await new Promise(resolve => setTimeout(resolve, 0));
    elements.get('customStorageEnabled').checked = true;
    await elements.get('customStorageEnabled').listeners.change();
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }

  const saveRequest = requests.find(request => request.options.method === 'POST');
  assert.ok(saveRequest, 'enable switch should save settings immediately');
  const savedSettings = JSON.parse(saveRequest.options.body);
  assert.equal(savedSettings.theme, 'dark');
  assert.equal(savedSettings.customStorage.enabled, true);
  assert.equal(savedSettings.customStorage.activeBucketId, 'bucket_default');
  assert.equal(elements.get('customStorageFieldsPanel').hidden, false);
  assert.match(elements.get('customStorageStatus').textContent, /已启用/);
});

test('custom storage secret visibility toggles password inputs with icon-only buttons', () => {
  const elements = new Map();
  const makeInput = () => ({ type: 'password' });
  const makeButton = () => ({
    textContent: '',
    innerHTML: '',
    title: '',
    dataset: {},
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
    click() {
      this.listeners.click?.();
    },
  });
  elements.set('customStorageAccessKeyId', makeInput());
  elements.set('customStorageSecretAccessKey', makeInput());
  elements.set('customStorageAccessKeyIdToggle', makeButton());
  elements.set('customStorageSecretAccessKeyToggle', makeButton());
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  try {
    bindSecretVisibilityToggles();
    const accessKeyInput = elements.get('customStorageAccessKeyId');
    const accessKeyToggle = elements.get('customStorageAccessKeyIdToggle');
    const secretInput = elements.get('customStorageSecretAccessKey');
    const secretToggle = elements.get('customStorageSecretAccessKeyToggle');

    assert.equal(accessKeyToggle.textContent, '');
    assert.match(accessKeyToggle.innerHTML, /settings-secret-toggle-icon/);
    assert.equal(accessKeyToggle.attributes['aria-label'], '显示密钥');

    accessKeyToggle.click();
    assert.equal(accessKeyInput.type, 'text');
    assert.equal(accessKeyToggle.textContent, '');
    assert.match(accessKeyToggle.innerHTML, /settings-secret-toggle-icon/);
    assert.equal(accessKeyToggle.title, '隐藏密钥');
    assert.equal(accessKeyToggle.attributes['aria-label'], '隐藏密钥');

    accessKeyToggle.click();
    assert.equal(accessKeyInput.type, 'password');
    assert.equal(accessKeyToggle.textContent, '');
    assert.equal(accessKeyToggle.title, '显示密钥');
    assert.equal(accessKeyToggle.attributes['aria-label'], '显示密钥');

    secretToggle.click();
    assert.equal(secretInput.type, 'text');
    assert.equal(secretToggle.textContent, '');
    assert.match(secretToggle.innerHTML, /settings-secret-toggle-icon/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('custom storage secret toggle is positioned inside the input in loaded settings styles', () => {
  for (const cssPath of ['style.css', 'styles/settings.css']) {
    const css = readFileSync(join(process.cwd(), cssPath), 'utf8');
    const wrapRule = css.match(/\.settings-secret-input-wrap\s*\{([\s\S]*?)\}/);
    const inputRule = css.match(/\.settings-secret-input-wrap\s+\.settings-input\s*\{([\s\S]*?)\}/);
    const toggleRule = css.match(/\.settings-secret-toggle\s*\{([\s\S]*?)\}/);

    assert.ok(wrapRule, `${cssPath} should define secret input wrapper style`);
    assert.ok(inputRule, `${cssPath} should reserve room for the inline toggle`);
    assert.ok(toggleRule, `${cssPath} should define secret toggle style`);
    assert.match(wrapRule[1], /position:\s*relative/);
    assert.match(inputRule[1], /padding-right:\s*58px/);
    assert.match(toggleRule[1], /position:\s*absolute/);
    assert.match(toggleRule[1], /right:\s*8px/);
    assert.match(toggleRule[1], /top:\s*calc\(50% \+ 5px\)/);
    assert.match(toggleRule[1], /width:\s*32px/);
    assert.match(toggleRule[1], /height:\s*32px/);
    assert.match(toggleRule[1], /padding:\s*0/);
    assert.match(toggleRule[1], /transform:\s*translateY\(-50%\)/);
    assert.match(css, /\.settings-secret-toggle-icon\s*\{/);
  }
});

test('custom storage connection test posts current form bucket config', async () => {
  const elements = new Map();
  const makeInput = (value = '', checked = false) => ({ value, checked, disabled: false, textContent: '' });
  elements.set('customStorageEnabled', makeInput('', true));
  elements.set('customStorageLabel', makeInput('MinIO'));
  elements.set('customStorageEndpoint', makeInput(' http://127.0.0.1:9000/ '));
  elements.set('customStorageRegion', makeInput('us-east-1'));
  elements.set('customStorageBucket', makeInput(' canvas-assets '));
  elements.set('customStorageAccessKeyId', makeInput('minio-user'));
  elements.set('customStorageSecretAccessKey', makeInput('minio-secret'));
  elements.set('customStorageForcePathStyle', makeInput('', true));
  elements.set('customStoragePublicBaseUrl', makeInput(' http://public.example.com/assets/ '));
  elements.set('customStoragePrefix', makeInput(' /ai-canvas// '));
  elements.set('btnCustomStorageTest', makeInput());
  elements.set('customStorageStatus', { textContent: '', dataset: {} });
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  let storageTestRequest = null;
  globalThis.document = {
    getElementById(id) {
      return elements.get(id) || null;
    },
  };
  globalThis.fetch = async (url, options) => {
    storageTestRequest = { url, options };
    return {
      ok: true,
      json: async () => ({ success: true, checks: { config: true, write: true, read: true, publicAccess: true, delete: true } }),
    };
  };
  try {
    await __testCustomStorage();
  } finally {
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }

  assert.equal(storageTestRequest.url, '/api/v2/storage/test');
  assert.equal(storageTestRequest.options.method, 'POST');
  assert.equal(storageTestRequest.options.headers['Content-Type'], 'application/json');
  const body = JSON.parse(storageTestRequest.options.body);
  assert.equal(body.endpoint, 'http://127.0.0.1:9000');
  assert.equal(body.bucket, 'canvas-assets');
  assert.equal(body.accessKeyId, 'minio-user');
  assert.equal(body.secretAccessKey, 'minio-secret');
  assert.equal(body.forcePathStyle, true);
  assert.equal(body.publicBaseUrl, 'http://public.example.com/assets');
  assert.equal(body.prefix, 'ai-canvas/');
});

test('custom storage error sanitizer masks secret values', () => {
  const message = sanitizeStorageErrorMessage(
    'upload failed with minio-secret and AKIA_TEST_KEY in request',
    {
      accessKeyId: 'AKIA_TEST_KEY',
      secretAccessKey: 'minio-secret',
    },
  );

  assert.equal(message.includes('minio-secret'), false);
  assert.equal(message.includes('AKIA_TEST_KEY'), false);
  assert.match(message, /\*\*\*/);
});