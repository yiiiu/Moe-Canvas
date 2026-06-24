import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ModelManifestError,
  ModelManifestRegistry,
  MODEL_MANIFEST_ERROR_CODES,
} from './modelManifestRegistry.js';
import { validateModelManifest } from './modelManifestSchema.js';
import {
  aiComicManifests,
  registerAiComicManifests,
} from './aiComicManifestPack.js';

const EXPECTED_MANIFEST_IDS = [
  'ai-comic-script',
  'ai-comic-storyboard',
  'ai-comic-character-card',
  'ai-comic-image-prompt',
  'ai-comic-video-prompt',
  'ai-comic-dubbing',
];

const REQUIRED_INPUT_FIELDS_BY_ID = Object.freeze({
  'ai-comic-script': ['theme', 'genre', 'duration', 'episodeCount', 'characters', 'style'],
  'ai-comic-storyboard': ['script', 'aspectRatio', 'shotCount', 'visualStyle', 'characterRefs'],
  'ai-comic-character-card': ['characterName', 'role', 'personality', 'appearance', 'outfit', 'anchorFeatures'],
  'ai-comic-image-prompt': ['scene', 'characterCard', 'shotType', 'emotion', 'action', 'aspectRatio', 'style'],
  'ai-comic-video-prompt': ['imageDescription', 'cameraMove', 'characterAction', 'duration', 'motionStrength', 'style'],
  'ai-comic-dubbing': ['script', 'characterName', 'voiceStyle', 'emotion', 'duration'],
});

function manifestIds(manifests) {
  return manifests.map((manifest) => manifest.id);
}

function sorted(values) {
  return [...values].sort();
}

test('aiComicManifests contains the six AI comic text manifests', () => {
  assert.equal(aiComicManifests.length, 6);
  assert.deepEqual(sorted(manifestIds(aiComicManifests)), sorted(EXPECTED_MANIFEST_IDS));
});

test('aiComicManifests have unique ids', () => {
  const ids = manifestIds(aiComicManifests);

  assert.equal(new Set(ids).size, ids.length);
});

test('each AI comic manifest passes schema validation and declares required inputs', () => {
  for (const manifest of aiComicManifests) {
    assert.equal(validateModelManifest(manifest), manifest);
    assert.equal(manifest.provider, 'openai-compatible');
    assert.equal(manifest.type, 'text');
    assert.ok(manifest.uiSchema);
    assert.ok(manifest.defaults);

    for (const field of REQUIRED_INPUT_FIELDS_BY_ID[manifest.id]) {
      assert.ok(manifest.inputSchema[field], `${manifest.id} missing input field ${field}`);
      assert.ok(manifest.uiSchema[field], `${manifest.id} missing ui field ${field}`);
    }
  }
});

test('registerAiComicManifests registers all manifests', () => {
  const registry = new ModelManifestRegistry();

  const returned = registerAiComicManifests(registry);

  assert.equal(returned, registry);
  assert.deepEqual(sorted(manifestIds(registry.listManifests())), sorted(EXPECTED_MANIFEST_IDS));
});

test('registered AI comic manifests can be queried by provider and type', () => {
  const registry = new ModelManifestRegistry();
  registerAiComicManifests(registry);

  const providerMatches = registry.listManifestsByProvider('openai-compatible');
  const typeMatches = registry.listManifestsByType('text');

  assert.deepEqual(sorted(manifestIds(providerMatches)), sorted(EXPECTED_MANIFEST_IDS));
  assert.deepEqual(sorted(manifestIds(typeMatches)), sorted(EXPECTED_MANIFEST_IDS));
});

test('registerAiComicManifests rejects duplicate registration by existing registry rules', () => {
  const registry = new ModelManifestRegistry();
  registerAiComicManifests(registry);

  assert.throws(
    () => registerAiComicManifests(registry),
    (error) => error instanceof ModelManifestError
      && error.code === MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_ALREADY_REGISTERED,
  );
});