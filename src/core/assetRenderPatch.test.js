import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResolvedAssetRenderPatch,
  __resetAssetRenderPatchForTest,
} from './assetRenderPatch.js';

async function withMockFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = handler;
    return await run();
  } finally {
    __resetAssetRenderPatchForTest();
    globalThis.fetch = originalFetch;
  }
}

test('asset render patch prefers image asset url and preserves legacy fields', async () => {
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ asset: { assetId: 'asset_image', url: 'https://cdn.example.com/image.png' } }),
  }), async () => {
    const nodeData = {
      id: 'image-node',
      type: 'source-image',
      assetId: 'asset_image',
      imageUrl: '/output/legacy-image.png',
      displayUrl: '/output/display-image.png',
      localPath: 'output/local-image.png',
    };

    const patch = await buildResolvedAssetRenderPatch(nodeData, { kind: 'image' });

    assert.equal(patch.imageUrl, 'https://cdn.example.com/image.png');
    assert.equal(patch.src, 'https://cdn.example.com/image.png');
    assert.equal(patch.asset.assetId, 'asset_image');
    assert.equal(patch.displayUrl, undefined);
    assert.equal(patch.localPath, undefined);
  });
});

test('asset render patch falls back without changing old image node when lookup fails', async () => {
  await withMockFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }), async () => {
    const patch = await buildResolvedAssetRenderPatch({
      id: 'old-image-node',
      type: 'source-image',
      assetId: 'missing',
      imageUrl: '/output/legacy-image.png',
      localPath: 'output/local-image.png',
    }, { kind: 'image' });

    assert.equal(patch, null);
  });
});

test('asset render patch supports old nodes without assetId as no-op', async () => {
  const patch = await buildResolvedAssetRenderPatch({
    id: 'old-video-node',
    type: 'source-video',
    videoUrl: '/output/legacy-video.mp4',
    localPath: 'output/legacy-video.mp4',
  }, { kind: 'video' });

  assert.equal(patch, null);
});

test('asset render patch writes video primary url only when asset lookup succeeds', async () => {
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ asset: { assetId: 'asset_video', url: 'https://cdn.example.com/video.mp4' } }),
  }), async () => {
    const patch = await buildResolvedAssetRenderPatch({
      id: 'video-node',
      type: 'source-video',
      assetId: 'asset_video',
      videoUrl: '/output/legacy-video.mp4',
      url: '/output/url-video.mp4',
      localPath: 'output/local-video.mp4',
    }, { kind: 'video' });

    assert.equal(patch.videoUrl, 'https://cdn.example.com/video.mp4');
    assert.equal(patch.url, 'https://cdn.example.com/video.mp4');
    assert.equal(patch.asset.assetId, 'asset_video');
  });
});

test('asset render patch writes audio primary url only when asset lookup succeeds', async () => {
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ asset: { assetId: 'asset_audio', url: 'https://cdn.example.com/audio.mp3' } }),
  }), async () => {
    const patch = await buildResolvedAssetRenderPatch({
      id: 'audio-node',
      type: 'source-audio',
      assetId: 'asset_audio',
      audioUrl: '/output/legacy-audio.mp3',
      src: '/output/src-audio.mp3',
      localPath: 'output/local-audio.mp3',
    }, { kind: 'audio' });

    assert.equal(patch.audioUrl, 'https://cdn.example.com/audio.mp3');
    assert.equal(patch.src, 'https://cdn.example.com/audio.mp3');
    assert.equal(patch.asset.assetId, 'asset_audio');
  });
});