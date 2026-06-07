import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenerationCollectionResultPatch,
  buildGenerationSingleResultPatch,
  firstNonEmptyString,
  getFirstGenerationResultError,
  normalizeGenerationResultItems,
} from './generationResultRenderer.js';

test('generationResultRenderer normalizes generation result items', () => {
  assert.deepEqual(
    normalizeGenerationResultItems({ outputType: 'image', items: [{ url: '/a.png' }] }),
    [{ url: '/a.png' }],
  );
  assert.deepEqual(
    normalizeGenerationResultItems({ videos: [{ videoUrl: '/a.mp4' }] }, { collectionField: 'videos' }),
    [{ videoUrl: '/a.mp4' }],
  );
  assert.deepEqual(normalizeGenerationResultItems([{ audioUrl: '/a.mp3' }]), [
    { audioUrl: '/a.mp3' },
  ]);
  assert.deepEqual(
    normalizeGenerationResultItems({ audioUrl: '/a.mp3' }, { singleItemFields: ['audioUrl'] }),
    [{ audioUrl: '/a.mp3' }],
  );
});

test('generationResultRenderer reads first result error', () => {
  assert.equal(
    getFirstGenerationResultError(
      { videos: [{ error: 'provider failed' }] },
      { collectionField: 'videos' },
    ),
    'provider failed',
  );
  assert.equal(firstNonEmptyString('', null, ' ok '), 'ok');
});

test('generationResultRenderer formats structured error objects as readable text', () => {
  assert.equal(firstNonEmptyString({ error: { message: 'Upstream video failed' } }), 'Upstream video failed');
  assert.equal(firstNonEmptyString({ error_message: 'Invalid aspect ratio' }), 'Invalid aspect ratio');
  assert.notEqual(firstNonEmptyString({ error: { message: 'Readable message' } }), '[object Object]');
});

test('generationResultRenderer builds collection result patch', () => {
  const patch = buildGenerationCollectionResultPatch(
    { videos: [{ videoUrl: '/out.mp4', localPath: 'output/out.mp4' }] },
    {
      collectionField: 'videos',
      mainIndexField: 'mainVideoIndex',
      expandedField: 'isVideosExpanded',
      startedAt: Date.now() - 10,
      buildFirstItemPatch: item => ({
        videoUrl: item.videoUrl,
        localPath: item.localPath,
      }),
      extraPatch: { rhStatusMessage: null },
    },
  );

  assert.equal(patch.jobStatus, 'success');
  assert.equal(patch.mainVideoIndex, 0);
  assert.equal(patch.isVideosExpanded, false);
  assert.equal(patch.videoUrl, '/out.mp4');
  assert.equal(patch.localPath, 'output/out.mp4');
  assert.equal(patch.rhStatusMessage, null);

  const failurePatch = buildGenerationCollectionResultPatch(
    { error: 'provider failed' },
    {
      collectionField: 'videos',
      mainIndexField: 'mainVideoIndex',
      singleItemFields: ['videoUrl'],
    },
  );

  assert.equal(failurePatch.jobStatus, 'error');
  assert.equal(failurePatch.jobError, 'provider failed');
  assert.equal(failurePatch.videos.length, 1);
});

test('generationResultRenderer collection patch can select a nonzero main item', () => {
  const patch = buildGenerationCollectionResultPatch(
    {
      videos: [
        { error: 'provider failed' },
        { videoUrl: '/out.mp4', localPath: 'output/out.mp4' },
      ],
    },
    {
      collectionField: 'videos',
      mainIndexField: 'mainVideoIndex',
      selectMainIndex: () => 1,
      buildFirstItemPatch: item => ({
        videoUrl: item.videoUrl,
        localPath: item.localPath,
      }),
    },
  );

  assert.equal(patch.jobStatus, 'success');
  assert.equal(patch.mainVideoIndex, 1);
  assert.equal(patch.videoUrl, '/out.mp4');
  assert.equal(patch.localPath, 'output/out.mp4');
});

test('generationResultRenderer builds single result patch without collection fields', () => {
  const patch = buildGenerationSingleResultPatch(
    { audioUrl: '/output/final.mp3', localPath: 'output/final.mp3' },
    {
      singleItemFields: ['audioUrl', 'localPath'],
      buildItemPatch: item => ({
        audioUrl: item.audioUrl,
        localPath: item.localPath,
      }),
      extraPatch: { rhStatusMessage: null },
    },
  );

  assert.equal(patch.jobStatus, 'success');
  assert.equal(patch.audioUrl, '/output/final.mp3');
  assert.equal(patch.localPath, 'output/final.mp3');
  assert.equal(patch.rhStatusMessage, null);

  const failurePatch = buildGenerationSingleResultPatch(
    { error: 'provider failed' },
    { singleItemFields: ['audioUrl'] },
  );

  assert.equal(failurePatch.jobStatus, 'error');
  assert.equal(failurePatch.jobError, 'provider failed');
});
