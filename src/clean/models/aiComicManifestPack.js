import { aiComicScriptManifest } from './manifests/aiComicScriptManifest.js';
import { aiComicStoryboardManifest } from './manifests/aiComicStoryboardManifest.js';
import { aiComicCharacterCardManifest } from './manifests/aiComicCharacterCardManifest.js';
import { aiComicImagePromptManifest } from './manifests/aiComicImagePromptManifest.js';
import { aiComicVideoPromptManifest } from './manifests/aiComicVideoPromptManifest.js';
import { aiComicDubbingManifest } from './manifests/aiComicDubbingManifest.js';

export const aiComicManifests = Object.freeze([
  aiComicScriptManifest,
  aiComicStoryboardManifest,
  aiComicCharacterCardManifest,
  aiComicImagePromptManifest,
  aiComicVideoPromptManifest,
  aiComicDubbingManifest,
]);

export function registerAiComicManifests(registry) {
  for (const manifest of aiComicManifests) {
    registry.registerManifest(manifest);
  }
  return registry;
}