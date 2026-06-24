export const MODEL_MANIFEST_TYPES = Object.freeze([
  'text',
  'image',
  'video',
  'audio',
  'multimodal',
]);

export const MODEL_MANIFEST_ERROR_CODES = Object.freeze({
  MODEL_MANIFEST_INVALID: 'MODEL_MANIFEST_INVALID',
  MODEL_MANIFEST_NOT_FOUND: 'MODEL_MANIFEST_NOT_FOUND',
  MODEL_MANIFEST_ALREADY_REGISTERED: 'MODEL_MANIFEST_ALREADY_REGISTERED',
  MODEL_MANIFEST_UNSUPPORTED_TYPE: 'MODEL_MANIFEST_UNSUPPORTED_TYPE',
});

export class ModelManifestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ModelManifestError';
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
      `Model manifest ${field} must be an object.`,
      { field },
    );
  }
}

export function validateModelManifest(manifest) {
  assertObject(manifest, 'manifest');

  const id = normalizeText(manifest.id);
  const name = normalizeText(manifest.name);
  const provider = normalizeText(manifest.provider);
  const type = normalizeText(manifest.type);

  if (!id) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
      'Model manifest id is required.',
      { field: 'id' },
    );
  }
  if (!name) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
      'Model manifest name is required.',
      { field: 'name', id },
    );
  }
  if (!provider) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
      'Model manifest provider is required.',
      { field: 'provider', id },
    );
  }
  if (!type) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_INVALID,
      'Model manifest type is required.',
      { field: 'type', id },
    );
  }
  if (!MODEL_MANIFEST_TYPES.includes(type)) {
    throw new ModelManifestError(
      MODEL_MANIFEST_ERROR_CODES.MODEL_MANIFEST_UNSUPPORTED_TYPE,
      'Model manifest type is unsupported.',
      { field: 'type', id, type },
    );
  }

  assertObject(manifest.capabilities, 'capabilities');
  assertObject(manifest.inputSchema, 'inputSchema');
  assertObject(manifest.uiSchema, 'uiSchema');
  assertObject(manifest.defaults, 'defaults');

  return manifest;
}