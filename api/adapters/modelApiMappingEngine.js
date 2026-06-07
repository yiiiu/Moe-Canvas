function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPresentValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

export function getPathValue(source, path) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return undefined;
  }
  return normalizedPath.split('.').reduce((current, key) => {
    if (current === undefined || current === null) {
      return undefined;
    }
    return current[key];
  }, source);
}

export function setPathValue(target, path, value) {
  const normalizedPath = String(path || '').trim();
  if (!normalizedPath) {
    return target;
  }

  const keys = normalizedPath.split('.').filter(Boolean);
  if (keys.length === 0) {
    return target;
  }

  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!isPlainObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return target;
}

function normalizeFieldList(entry) {
  const rawFields = entry?.fields !== undefined ? entry.fields : entry?.field;
  const fields = Array.isArray(rawFields) ? rawFields : [rawFields];
  return fields.map(field => String(field || '').trim()).filter(Boolean);
}

function resolveFirstPayloadValue(payload, fields) {
  for (const field of fields) {
    const value = getPathValue(payload, field);
    if (isPresentValue(value)) {
      return value;
    }
  }
  return undefined;
}

function valuesEqual(actualValue, expectedValue) {
  if (typeof expectedValue === 'boolean') {
    const actualText = String(actualValue ?? '').trim().toLowerCase();
    return actualValue === expectedValue || actualText === String(expectedValue);
  }
  if (typeof expectedValue === 'number') {
    return Number(actualValue) === expectedValue;
  }
  return String(actualValue ?? '').trim() === String(expectedValue ?? '').trim();
}

function evaluateWhenRule(rule, context) {
  if (!rule || typeof rule !== 'object') {
    return true;
  }

  const value = rule.field ? getPathValue(context.payload || {}, rule.field) : undefined;
  const exists = isPresentValue(value);

  if (Object.prototype.hasOwnProperty.call(rule, 'exists') && Boolean(rule.exists) !== exists) {
    return false;
  }
  if (rule.truthy === true && !Boolean(value)) {
    return false;
  }
  if (rule.falsy === true && Boolean(value)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'equals') && !valuesEqual(value, rule.equals)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'notEquals') && valuesEqual(value, rule.notEquals)) {
    return false;
  }
  if (Array.isArray(rule.in) && !rule.in.some(item => valuesEqual(value, item))) {
    return false;
  }
  if (Array.isArray(rule.notIn) && rule.notIn.some(item => valuesEqual(value, item))) {
    return false;
  }

  return true;
}

function shouldApplyEntry(entry, context) {
  if (!entry?.when) {
    return true;
  }
  if (Array.isArray(entry.when)) {
    return entry.when.every(rule => evaluateWhenRule(rule, context));
  }
  return evaluateWhenRule(entry.when, context);
}

function normalizeMappingEntries(bodyMapping) {
  if (Array.isArray(bodyMapping)) {
    return bodyMapping;
  }
  if (Array.isArray(bodyMapping?.entries)) {
    return bodyMapping.entries;
  }
  return [];
}

function createPromptMessages(prompt) {
  const content = String(prompt || '').trim();
  if (!content) {
    return [];
  }
  return [{ role: 'user', content }];
}

function normalizeMediaUrls(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

function createPromptMessagesWithImages(prompt, inputImages = []) {
  const text = String(prompt || '').trim();
  const images = normalizeMediaUrls(inputImages);
  if (images.length === 0) {
    return createPromptMessages(text);
  }

  const content = [
    ...(text ? [{ type: 'text', text }] : []),
    ...images.map(url => ({
      type: 'image_url',
      image_url: { url },
    })),
  ];

  return content.length > 0 ? [{ role: 'user', content }] : [];
}

function resolveEntrySourceValue(entry, context) {
  const source = String(entry?.from || '').trim();

  if (source === 'prompt') {
    return context.finalPrompt || '';
  }
  if (source === 'promptMessages') {
    return createPromptMessages(context.finalPrompt);
  }
  if (source === 'promptMessagesWithImages') {
    return createPromptMessagesWithImages(context.finalPrompt, context.inputImages || []);
  }
  if (source === 'payload') {
    return resolveFirstPayloadValue(context.payload || {}, normalizeFieldList(entry));
  }
  if (source === 'inputImages') {
    return context.inputImages || [];
  }
  if (source === 'inputVideos') {
    return context.inputVideos || [];
  }
  if (source === 'inputAudios') {
    return context.inputAudios || [];
  }
  if (source === 'model') {
    return context.modelToken || '';
  }
  if (source === 'constant') {
    return Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry.defaultValue;
  }
  if (source === 'param') {
    return getPathValue(context.payload || {}, entry.field);
  }

  return undefined;
}

function normalizeTransformList(transform) {
  if (!transform) {
    return [];
  }
  return Array.isArray(transform) ? transform : [transform];
}

async function applyTransforms(value, entry, context, transforms) {
  let nextValue = value;

  for (const transform of normalizeTransformList(entry?.transform)) {
    const spec = typeof transform === 'string'
      ? { name: transform }
      : isPlainObject(transform)
        ? transform
        : { name: '' };
    const transformName = String(spec.name || '').trim();
    if (!transformName) {
      continue;
    }

    const resolver = transforms?.[transformName];
    if (typeof resolver !== 'function') {
      throw new Error(`Unsupported model API bodyMapping transform: ${transformName}`);
    }

    nextValue = await resolver(nextValue, { entry, context, spec });
  }

  return nextValue;
}

export async function buildBodyFromMapping({ bodyMapping, context, transforms = {} }) {
  const body = {};
  const entries = normalizeMappingEntries(bodyMapping);
  const mappingContext = {
    ...context,
    body,
  };

  for (const entry of entries) {
    if (!entry?.path || !shouldApplyEntry(entry, mappingContext)) {
      continue;
    }

    let value = resolveEntrySourceValue(entry, mappingContext);
    if (!isPresentValue(value) && Object.prototype.hasOwnProperty.call(entry, 'defaultValue')) {
      value = entry.defaultValue;
    }

    value = await applyTransforms(value, entry, mappingContext, transforms);
    if (entry.omitWhenEmpty === true && !isPresentValue(value)) {
      continue;
    }

    setPathValue(body, entry.path, value);
  }

  return body;
}

function collectValuesByPath(source, path) {
  const keys = String(path || '').trim().split('.').filter(Boolean);
  if (keys.length === 0) {
    return [];
  }

  const collect = (value, keyIndex) => {
    if (value === undefined || value === null) {
      return [];
    }
    if (keyIndex >= keys.length) {
      return Array.isArray(value) ? value : [value];
    }

    const key = keys[keyIndex];
    if (key.endsWith('[]')) {
      const arrayKey = key.slice(0, -2);
      const arrayValue = arrayKey ? value?.[arrayKey] : value;
      if (!Array.isArray(arrayValue)) {
        return [];
      }
      return arrayValue.flatMap(item => collect(item, keyIndex + 1));
    }

    return collect(value?.[key], keyIndex + 1);
  };

  return collect(source, 0).flatMap(value => (Array.isArray(value) ? value : [value]));
}

export function resolveMappedResponseValues(payload, fields = []) {
  const normalizedFields = Array.isArray(fields) ? fields : [fields];
  const values = [];

  for (const field of normalizedFields) {
    for (const value of collectValuesByPath(payload, field)) {
      if (value && typeof value === 'object') {
        const url = value.url
          || value.imageUrl
          || value.image_url
          || value.videoUrl
          || value.video_url
          || value.fileUrl;
        if (url) {
          values.push(String(url).trim());
        }
        continue;
      }

      const text = String(value ?? '').trim();
      if (text) {
        values.push(text);
      }
    }
  }

  return Array.from(new Set(values.filter(Boolean)));
}

export function resolveMappedResponseValue(payload, fields = []) {
  return resolveMappedResponseValues(payload, fields)[0] || '';
}