import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCanvasAudioUrl,
  resolveCanvasImageDisplayUrl,
  resolveCanvasVideoUrl,
} from './canvasMediaLocalService.js';
import { __resetAssetRenderPatchForTest } from '../core/assetRenderPatch.js';

async function waitForMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

test('canvas media url resolver uses embedded image asset url synchronously', () => {
  assert.equal(resolveCanvasImageDisplayUrl({
    id: 'image-node',
    type: 'source-image',
    assetId: 'asset_image',
    asset: { assetId: 'asset_image', url: 'https://cdn.example.com/image.png' },
    imageUrl: '/output/legacy-image.png',
    localPath: 'output/legacy-image.png',
  }), 'https://cdn.example.com/image.png');
});

test('canvas media url resolver falls back and patches image node after asset lookup', async () => {
  const patches = [];
  await withMockFetch(async () => ({
    ok: true,
    json: async () => ({ asset: { assetId: 'asset_image', url: 'https://cdn.example.com/image.png' } }),
  }), async () => {
    const fallback = resolveCanvasImageDisplayUrl({
      id: 'image-node',
      type: 'source-image',
      assetId: 'asset_image',
      imageUrl: '/output/legacy-image.png',
      localPath: 'output/legacy-image.png',
    }, { store: { updateNodeData: (nodeId, patch) => patches.push({ nodeId, patch }) } });

    assert.equal(fallback, '/output/legacy-image.png');
    await waitForMicrotasks();

    assert.deepEqual(patches, [{
      nodeId: 'image-node',
      patch: {
        imageUrl: 'https://cdn.example.com/image.png',
        src: 'https://cdn.example.com/image.png',
        asset: { assetId: 'asset_image', url: 'https://cdn.example.com/image.png' },
        assetId: 'asset_image',
      },
    }]);
  });
});

test('canvas media url resolver patches video and audio primary urls after asset lookup', async () => {
  const patches = [];
  await withMockFetch(async (url) => ({
    ok: true,
    json: async () => String(url).includes('asset_video')
      ? { asset: { assetId: 'asset_video', url: 'https://cdn.example.com/video.mp4' } }
      : { asset: { assetId: 'asset_audio', url: 'https://cdn.example.com/audio.mp3' } },
  }), async () => {
    assert.equal(resolveCanvasVideoUrl({
      id: 'video-node',
      type: 'source-video',
      assetId: 'asset_video',
      videoUrl: '/output/legacy-video.mp4',
      localPath: 'output/legacy-video.mp4',
    }, { store: { updateNodeData: (nodeId, patch) => patches.push({ nodeId, patch }) } }), '/output/legacy-video.mp4');

    assert.equal(resolveCanvasAudioUrl({
      id: 'audio-node',
      type: 'source-audio',
      assetId: 'asset_audio',
      audioUrl: '/output/legacy-audio.mp3',
      localPath: 'output/legacy-audio.mp3',
    }, { store: { updateNodeData: (nodeId, patch) => patches.push({ nodeId, patch }) } }), '/output/legacy-audio.mp3');

    await waitForMicrotasks();

    assert.equal(patches.length, 2);
    assert.equal(patches[0].nodeId, 'video-node');
    assert.equal(patches[0].patch.videoUrl, 'https://cdn.example.com/video.mp4');
    assert.equal(patches[0].patch.url, 'https://cdn.example.com/video.mp4');
    assert.equal(patches[1].nodeId, 'audio-node');
    assert.equal(patches[1].patch.audioUrl, 'https://cdn.example.com/audio.mp3');
    assert.equal(patches[1].patch.src, 'https://cdn.example.com/audio.mp3');
  });
});

test('canvas media url resolver queries assetId without explicit store to support normal node render calls', async () => {
  let fetchCount = 0;
  await withMockFetch(async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({ asset: { assetId: 'asset_image', url: 'https://cdn.example.com/image.png' } }),
    };
  }, async () => {
    assert.equal(resolveCanvasImageDisplayUrl({
      id: 'image-node',
      type: 'source-image',
      assetId: 'asset_image',
      imageUrl: '/output/legacy-image.png',
      localPath: 'output/legacy-image.png',
    }), '/output/legacy-image.png');

    await waitForMicrotasks();
    assert.equal(fetchCount, 1);
  });
});

test('canvas media url resolver keeps legacy fallback when asset lookup fails', async () => {
  const patches = [];
  await withMockFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }), async () => {
    assert.equal(resolveCanvasVideoUrl({
      id: 'video-node',
      type: 'source-video',
      assetId: 'missing',
      videoUrl: '/output/legacy-video.mp4',
      localPath: 'output/legacy-video.mp4',
    }, { store: { updateNodeData: (nodeId, patch) => patches.push({ nodeId, patch }) } }), '/output/legacy-video.mp4');

    await waitForMicrotasks();
    assert.deepEqual(patches, []);
  });
});