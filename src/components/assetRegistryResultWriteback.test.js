import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImageGenerationResultPatch } from './aigenImage/imageGenerationResultRenderer.js';
import { buildVideoGenerationResultPatch } from './video-node/videoGenerationResultRenderer.js';
import { buildLocalAudioGenerationResultPatch } from './audio-node/audioGenerationResultRenderer.js';

test('generation result renderers copy assetId to node data patch without changing media urls', () => {
  const imagePatch = buildImageGenerationResultPatch({
    imageUrl: '/output/image.png',
    localPath: 'output/image.png',
    assetId: 'asset_image',
    asset: { assetId: 'asset_image', type: 'image' },
  });
  assert.equal(imagePatch.imageUrl, '/output/image.png');
  assert.equal(imagePatch.localPath, 'output/image.png');
  assert.equal(imagePatch.assetId, 'asset_image');
  assert.equal(imagePatch.asset.assetId, 'asset_image');

  const videoPatch = buildVideoGenerationResultPatch({
    videoUrl: '/output/video.mp4',
    localPath: 'output/video.mp4',
    assetId: 'asset_video',
    asset: { assetId: 'asset_video', type: 'video' },
  });
  assert.equal(videoPatch.videoUrl, '/output/video.mp4');
  assert.equal(videoPatch.localPath, 'output/video.mp4');
  assert.equal(videoPatch.assetId, 'asset_video');
  assert.equal(videoPatch.asset.assetId, 'asset_video');

  const audioPatch = buildLocalAudioGenerationResultPatch({
    audioUrl: '/output/audio.mp3',
    localPath: 'output/audio.mp3',
    assetId: 'asset_audio',
    asset: { assetId: 'asset_audio', type: 'audio' },
  });
  assert.equal(audioPatch.audioUrl, '/output/audio.mp3');
  assert.equal(audioPatch.localPath, 'output/audio.mp3');
  assert.equal(audioPatch.assetId, 'asset_audio');
  assert.equal(audioPatch.asset.assetId, 'asset_audio');
});