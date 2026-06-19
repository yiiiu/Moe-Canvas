const HELLOBABYGO_PROVIDER_PREFIX = /^hellobabygo\//i;

function normalizeModelToken(model) {
  const token = String(model || '').trim().replace(HELLOBABYGO_PROVIDER_PREFIX, '');
  return token || 'grok-imagine-video-1.5-preview';
}

function normalizeResolution(value) {
  const resolution = String(value || '720p').trim().toLowerCase();
  if (resolution === '4k') {
    return '4k';
  }
  if (resolution === '1080p') {
    return '1080p';
  }
  return '720p';
}

function normalizeRatio(value) {
  const ratio = String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  if (ratio === '9:16') {
    return '9:16';
  }
  if (ratio === '16:9') {
    return '16:9';
  }
  return '16:9';
}

function getGenerationParams(context = {}) {
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  return payload.generationParams && typeof payload.generationParams === 'object' && !Array.isArray(payload.generationParams)
    ? payload.generationParams
    : {};
}

function isPresentValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return true;
}

function hasImageInput(context = {}) {
  if (Array.isArray(context?.inputImages) && context.inputImages.length > 0) {
    return true;
  }
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  return [payload.images, payload.inputUrls, payload.inputImageUrls, payload.input_reference]
    .some(value => Array.isArray(value) ? value.some(Boolean) : Boolean(String(value || '').trim()));
}

export function resolveHellobabyGoVideoInputReference(value, { context } = {}) {
  if (isOmniModelToken(getCurrentModelToken(context))) {
    return undefined;
  }
  if (getGenerationType(context) !== 'reference') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find(item => String(item || '').trim()) || undefined;
  }
  const normalizedValue = String(value || '').trim();
  return normalizedValue || undefined;
}

function getVeoOrientation(ratio) {
  return normalizeRatio(ratio) === '9:16' ? 'portrait' : 'landscape';
}

function shouldUseVeoHdModel(context = {}) {
  const generationType = getGenerationType(context);
  if (generationType === 'text_hd' || generationType === 'frame' || generationType === 'reference') {
    return true;
  }
  if (generationType === 'text') {
    return false;
  }
  return shouldUseVeoFrameModel(context);
}

function isVeoModelToken(token) {
  return /^veo_3_1-fast-(?:landscape|portrait)(?:-fl)?(?:-hd)?$/i.test(String(token || '').trim());
}

function isOmniModelToken(token) {
  return String(token || '').trim().toLowerCase() === 'omni_flash';
}

function getCurrentModelToken(context = {}) {
  return normalizeModelToken(context?.body?.model || context?.payload?.model || context?.modelToken || '');
}

function getGenerationType(context = {}) {
  const generationParams = getGenerationParams(context);
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  return String(generationParams.generation_type ?? payload.generation_type ?? '').trim().toLowerCase();
}

function shouldUseVeoFrameModel(context = {}) {
  const generationType = getGenerationType(context);
  if (generationType === 'frame') {
    return true;
  }
  if (generationType === 'reference' || generationType === 'text' || generationType === 'text_hd') {
    return false;
  }
  return hasImageInput(context);
}

function resolveHellobabyGoVeoModelToken(context = {}) {
  const generationParams = getGenerationParams(context);
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  const ratio = generationParams.aspectRatio ?? payload.aspectRatio ?? payload.resolvedRatioLabel;
  const orientation = getVeoOrientation(ratio);
  const frameSuffix = shouldUseVeoFrameModel(context) ? '-fl' : '';
  const hdSuffix = shouldUseVeoHdModel(context) ? '-hd' : '';
  return `veo_3_1-fast-${orientation}${frameSuffix}${hdSuffix}`;
}

export function resolveHellobabyGoVideoModelToken(value, { context } = {}) {
  const token = normalizeModelToken(value);
  if (!isVeoModelToken(token)) {
    return token;
  }
  return resolveHellobabyGoVeoModelToken(context);
}

export function resolveHellobabyGoVideoSeconds(value, { context } = {}) {
  const modelToken = getCurrentModelToken(context);
  if (isVeoModelToken(modelToken)) {
    return undefined;
  }
  return String(isPresentValue(value) ? value : '10').trim();
}

export function resolveHellobabyGoVideoDuration(_value, { context } = {}) {
  const modelToken = getCurrentModelToken(context);
  if (!isVeoModelToken(modelToken)) {
    return undefined;
  }
  return 8;
}

export function resolveHellobabyGoVideoSize(value, { context } = {}) {
  const rawSize = String(value || '').trim();
  if (/^\d{3,5}x\d{3,5}$/i.test(rawSize)) {
    return rawSize.toLowerCase();
  }

  const normalizedRatio = rawSize.replace(/\s+/g, '');
  const generationParams = getGenerationParams(context);
  const payload = context?.payload && typeof context.payload === 'object' ? context.payload : {};
  const resolution = normalizeResolution(generationParams.resolution ?? payload.resolution);
  const dimensionMap = {
    '720p': { '16:9': '1280x720', '9:16': '720x1280' },
    '1080p': { '16:9': '1920x1080', '9:16': '1080x1920' },
    '4k': { '16:9': '3840x2160', '9:16': '2160x3840' },
  };

  if (dimensionMap[resolution]?.[normalizedRatio]) {
    return dimensionMap[resolution][normalizedRatio];
  }
  if (normalizedRatio === '3:2' || normalizedRatio === '4:3') {
    return '1792x1024';
  }
  if (normalizedRatio === '2:3' || normalizedRatio === '3:4') {
    return '1024x1792';
  }
  return '1024x1024';
}