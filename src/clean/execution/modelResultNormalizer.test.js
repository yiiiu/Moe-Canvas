import test from 'node:test';
import assert from 'node:assert/strict';

import { openaiChatManifest } from '../models/manifests/openaiChatManifest.js';
import {
  ModelExecutionError,
  MODEL_EXECUTION_ERROR_CODES,
} from './modelExecutionErrors.js';
import { normalizeModelResult } from './modelResultNormalizer.js';

function manifestOfType(type) {
  return {
    id: `mock-${type}-model`,
    name: `Mock ${type} Model`,
    provider: 'mock-provider',
    type,
  };
}

function assertModelExecutionError(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ModelExecutionError && error.code === code,
  );
}

test('normalizeModelResult normalizes OpenAI chat message content to text', () => {
  const providerResult = {
    choices: [
      {
        message: {
          content: 'Hello from chat.',
        },
      },
    ],
  };

  assert.deepEqual(
    normalizeModelResult({ manifest: openaiChatManifest, providerResult }),
    {
      type: 'text',
      text: 'Hello from chat.',
      raw: providerResult,
    },
  );
});

test('normalizeModelResult normalizes plain string result to text', () => {
  assert.deepEqual(
    normalizeModelResult({ manifest: openaiChatManifest, providerResult: 'Plain text.' }),
    {
      type: 'text',
      text: 'Plain text.',
      raw: 'Plain text.',
    },
  );
});

test('normalizeModelResult normalizes image result to images', () => {
  const providerResult = {
    images: [
      { url: 'file:///image.png' },
    ],
  };

  assert.deepEqual(
    normalizeModelResult({ manifest: manifestOfType('image'), providerResult }),
    {
      type: 'image',
      images: providerResult.images,
      raw: providerResult,
    },
  );
});

test('normalizeModelResult normalizes video result to videos', () => {
  const providerResult = {
    videos: [
      { url: 'file:///video.mp4' },
    ],
  };

  assert.deepEqual(
    normalizeModelResult({ manifest: manifestOfType('video'), providerResult }),
    {
      type: 'video',
      videos: providerResult.videos,
      raw: providerResult,
    },
  );
});

test('normalizeModelResult normalizes audio result to audios', () => {
  const providerResult = {
    audios: [
      { url: 'file:///audio.wav' },
    ],
  };

  assert.deepEqual(
    normalizeModelResult({ manifest: manifestOfType('audio'), providerResult }),
    {
      type: 'audio',
      audios: providerResult.audios,
      raw: providerResult,
    },
  );
});

test('normalizeModelResult rejects unsupported manifest type', () => {
  assertModelExecutionError(
    () => normalizeModelResult({
      manifest: manifestOfType('embedding'),
      providerResult: 'value',
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_UNSUPPORTED_TYPE,
  );
});

test('normalizeModelResult rejects empty provider result', () => {
  assertModelExecutionError(
    () => normalizeModelResult({
      manifest: openaiChatManifest,
      providerResult: null,
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_BAD_RESULT,
  );
});