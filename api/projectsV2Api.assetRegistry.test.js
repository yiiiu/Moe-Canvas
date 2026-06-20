import test from 'node:test';
import assert from 'node:assert/strict';

import {
  saveOutputFromUrlToServer,
  saveOutputToServer,
  uploadFileToServer,
} from './projectsV2Api.js';

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('projectsV2Api preserves asset registry fields from saved output responses', async () => {
  const originalFetch = globalThis.fetch;
  const payload = {
    success: true,
    localPath: 'output/out.png',
    url: '/output/out.png',
    displayUrl: '/output/_derived/display/out.display.jpg',
    thumbUrl: '/output/_derived/thumb/out.thumb.jpg',
    assetId: 'asset_123',
    asset: {
      assetId: 'asset_123',
      type: 'image',
      storage: { type: 'local', bucket: '', endpoint: '' },
    },
  };
  try {
    globalThis.fetch = async () => jsonResponse(payload);

    const saved = await saveOutputToServer(new Blob(['image-bytes']), { ext: 'png' });

    assert.equal(saved.assetId, 'asset_123');
    assert.equal(saved.asset.assetId, 'asset_123');
    assert.equal(saved.url, '/output/out.png');
    assert.equal(saved.displayUrl, '/output/_derived/display/out.display.jpg');
    assert.equal(saved.thumbUrl, '/output/_derived/thumb/out.thumb.jpg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('projectsV2Api preserves asset registry fields from url save and upload responses', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    {
      success: true,
      localPath: 'output/video.mp4',
      url: '/output/video.mp4',
      assetId: 'asset_video',
      asset: { assetId: 'asset_video', type: 'video', storage: { type: 'local' } },
    },
    {
      success: true,
      localPath: 'data/uploads/audio.mp3',
      url: '/data/uploads/audio.mp3',
      assetId: 'asset_audio',
      asset: { assetId: 'asset_audio', type: 'audio', storage: { type: 'local' } },
    },
  ];
  try {
    globalThis.fetch = async () => jsonResponse(responses.shift());

    const fromUrl = await saveOutputFromUrlToServer({ url: 'https://cdn.example.com/video.mp4', ext: 'mp4', dedupeKey: 'asset-test-video' });
    const uploaded = await uploadFileToServer(new File(['audio-bytes'], 'audio.mp3', { type: 'audio/mpeg' }));

    assert.equal(fromUrl.assetId, 'asset_video');
    assert.equal(fromUrl.asset.type, 'video');
    assert.equal(uploaded.assetId, 'asset_audio');
    assert.equal(uploaded.asset.type, 'audio');
  } finally {
    globalThis.fetch = originalFetch;
  }
});