import {
  MODEL_MANIFEST_ERROR_CODES,
  ModelManifestError,
  validateModelManifest,
} from './modelManifestSchema.js';
import { openaiChatManifest } from './manifests/openaiChatManifest.js';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export { MODEL_MANIFEST_ERROR_CODES, ModelManifestError };

export class ModelManifestRegistry {
  constructor(manifests = []) {
    this.manifests = new Map();
    for (const manifest of manifests) {
      this.registerManifest(manifest);
    }
  }

  registerManifest(manifest) {
    validateModelManifest(manifest);
    const id = normalizeText(manifest.id);
    if (this.manifests.has(id)) {
      throw new ModelManifestError(
        MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_ALREADY_REGISTERED,
        'Model manifest is already registered.',
        { id },
      );
    }
    this.manifests.set(id, manifest);
    return this;
  }

  hasManifest(id) {
    return this.manifests.has(normalizeText(id));
  }

  getManifest(id) {
    const manifestId = normalizeText(id);
    if (!this.manifests.has(manifestId)) {
      throw new ModelManifestError(
        MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_NOT_FOUND,
        'Model manifest is not registered.',
        { id: manifestId },
      );
    }
    return this.manifests.get(manifestId);
  }

  listManifests() {
    return [...this.manifests.values()];
  }

  listManifestsByProvider(provider) {
    const targetProvider = normalizeText(provider);
    return this.listManifests().filter((manifest) => manifest.provider === targetProvider);
  }

  listManifestsByType(type) {
    const targetType = normalizeText(type);
    return this.listManifests().filter((manifest) => manifest.type === targetType);
  }
}

export function createDefaultModelManifestRegistry() {
  return new ModelManifestRegistry([
    openaiChatManifest,
  ]);
}

export const defaultModelManifestRegistry = createDefaultModelManifestRegistry();