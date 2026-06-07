const CUSTOM_TEXT_MODELS_KEY = 'v2-custom-text-models';

function normalizeText(value) {
  return String(value || '').trim();
}

function readLegacyCustomTextModels() {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_TEXT_MODELS_KEY)) || [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeText).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function getCustomTextModels() {
  return readLegacyCustomTextModels();
}

export function saveCustomTextModels(models) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const legacyItems = (Array.isArray(models) ? models : [])
    .filter(item => typeof item === 'string')
    .map(normalizeText)
    .filter(Boolean);

  localStorage.setItem(
    CUSTOM_TEXT_MODELS_KEY,
    JSON.stringify([...new Set(legacyItems)]),
  );
}