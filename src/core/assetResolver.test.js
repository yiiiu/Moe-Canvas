import test from 'node:test';
import assert from 'node:assert/strict';

import {
  preloadAssets,
  resolveAsset,
  resolveAssetUrl,
  __resetAssetResolverForTest,
} from './assetResolver.js';

test('assetResolver prefers embedded asset url before querying assetId', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error('should not fetch');
    };

    const data = {
      assetId: 'asset_image_1',
      asset: { assetId: 'asset_image_1', url: 'https://cdn.example.com/asset.png' },
      displayUrl: '/output/display.png',
      url: '/output/original.png',
      localPath: 'output/local.png',
    };

    assert.equal(await resolveAssetUrl(data), 'https://cdn.example.com/asset.png');
    assert.equal(fetchCount, 0);
  } finally {
    __resetAssetResolverForTest();
    globalThis.fetch = originalFetch;
  }
});

test('assetResolver queries assetId and uses AssetRecord url before legacy urls', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, asset: { assetId: 'asset_video_1', url: 'https://cdn.example.com/video.mp4' } }),
      };
    };

    const data = {
      assetId: 'asset_video_1',
      videoUrl: '/output/legacy-video.mp4',
      displayUrl: '/output/display-video.mp4',
      url: '/output/url-video.mp4',
      localPath: 'output/local-video.mp4',
    };

    assert.equal(await resolveAssetUrl(data), 'https://cdn.example.com/video.mp4');
    assert.deepEqual(requested, ['/api/v2/assets/asset_video_1']);
  } finally {
    __resetAssetResolverForTest();
    globalThis.fetch = originalFetch;
  }
});

test('assetResolver falls back to old urls when asset query fails', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ success: false }) });

    assert.equal(
      await resolveAssetUrl({ assetId: 'missing', displayUrl: '/output/display.png', url: '/output/original.png', localPath: 'output/local.png' }),
      '/output/display.png',
    );
    assert.equal(
      await resolveAssetUrl({ assetId: 'missing', audioUrl: '/output/audio.mp3', url: '/output/original.mp3' }, { kind: 'audio' }),
      '/output/audio.mp3',
    );
  } finally {
    __resetAssetResolverForTest();
    globalThis.fetch = originalFetch;
  }
});

test('assetResolver keeps old nodes without assetId renderable and does not use thumbUrl as main url', async () => {
  assert.equal(await resolveAssetUrl({ displayUrl: '/output/display.png', url: '/output/original.png', localPath: 'output/local.png', thumbUrl: '/output/thumb.png' }), '/output/display.png');
  assert.equal(await resolveAssetUrl({ url: '/output/original.png', localPath: 'output/local.png', thumbUrl: '/output/thumb.png' }), '/output/original.png');
  assert.equal(await resolveAssetUrl({ localPath: 'output/local.png', thumbUrl: '/output/thumb.png' }), '/output/local.png');
  assert.equal(await resolveAssetUrl({ thumbUrl: '/output/thumb.png' }), '');
});

test('assetResolver supports image video audio legacy field priority', async () => {
  assert.equal(await resolveAssetUrl({ imageUrl: '/output/image.png', displayUrl: '/output/display.png' }, { kind: 'image' }), '/output/display.png');
  assert.equal(await resolveAssetUrl({ videoUrl: '/output/video.mp4', displayUrl: '/output/display.mp4' }, { kind: 'video' }), '/output/video.mp4');
  assert.equal(await resolveAssetUrl({ audioUrl: '/output/audio.mp3', url: '/output/url.mp3' }, { kind: 'audio' }), '/output/audio.mp3');
});

test('preloadAssets uses batch endpoint and caches returned assets', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, assets: [{ assetId: 'asset_audio_1', url: 'https://cdn.example.com/audio.mp3' }] }),
      };
    };

    await preloadAssets(['asset_audio_1', '', 'asset_audio_1']);

    assert.deepEqual(requests, [{ url: '/api/v2/assets/batch', body: { assetIds: ['asset_audio_1'] } }]);
    assert.deepEqual(await resolveAsset({ assetId: 'asset_audio_1' }), { assetId: 'asset_audio_1', url: 'https://cdn.example.com/audio.mp3' });
    assert.equal(await resolveAssetUrl({ assetId: 'asset_audio_1', audioUrl: '/output/fallback.mp3' }, { kind: 'audio' }), 'https://cdn.example.com/audio.mp3');
  } finally {
    __resetAssetResolverForTest();
    globalThis.fetch = originalFetch;
  }
});