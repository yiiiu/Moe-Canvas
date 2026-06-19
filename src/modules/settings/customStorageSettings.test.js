import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCustomStorageSettings,
  normalizeCustomStorageSettings,
  sanitizeStorageErrorMessage,
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
  assert.equal(merged.customStorage.enabled, true);
  assert.equal(merged.customStorage.buckets[0].providerType, 's3-compatible');
  assert.equal(merged.customStorage.buckets[0].prefix, 'media/');
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