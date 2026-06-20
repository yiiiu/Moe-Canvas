const assetCache = new Map();
const failedAssetIds = new Set();

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeNodeData(value) {
  const object = asObject(value) || {};
  if (asObject(object.data)) {
    const nested = object.data;
    const hasTopLevelMedia = Boolean(
      object.asset || object.assetId || object.displayUrl || object.url || object.localPath || object.imageUrl || object.videoUrl || object.audioUrl,
    );
    return hasTopLevelMedia ? object : nested;
  }
  return object;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function localPathToUrl(value) {
  const text = firstString(value);
  if (!text) return '';
  if (/^(https?:|blob:|data:|\/)/i.test(text)) return text;
  return `/${text.replace(/^\/+/, '')}`;
}

function normalizeAssetId(value) {
  return String(value || '').trim();
}

function normalizeAssetPayload(payload) {
  const data = asObject(payload) || {};
  const asset = asObject(data.asset) || data;
  const assetId = normalizeAssetId(asset.assetId);
  if (!assetId) return null;
  return { ...asset, assetId };
}

function getEmbeddedAsset(data) {
  const asset = asObject(data.asset);
  const url = firstString(asset?.url);
  if (!asset || !url) return null;
  return { ...asset, url, assetId: normalizeAssetId(asset.assetId || data.assetId) };
}

async function fetchAsset(assetId) {
  const id = normalizeAssetId(assetId);
  if (!id) return null;
  if (assetCache.has(id)) return assetCache.get(id);
  if (failedAssetIds.has(id)) return null;
  try {
    const response = await fetch(`/api/v2/assets/${encodeURIComponent(id)}`);
    if (!response || !response.ok) {
      failedAssetIds.add(id);
      return null;
    }
    const payload = await response.json();
    const asset = normalizeAssetPayload(payload);
    if (!asset) {
      failedAssetIds.add(id);
      return null;
    }
    assetCache.set(id, asset);
    return asset;
  } catch {
    failedAssetIds.add(id);
    return null;
  }
}

function resolveLegacyUrl(data, options = {}) {
  const kind = String(options.kind || data.type || data.outputType || '').trim().toLowerCase();
  if (kind === 'video') {
    return firstString(data.videoUrl, data.url, data.displayUrl) || localPathToUrl(data.localPath);
  }
  if (kind === 'audio') {
    return firstString(data.audioUrl, data.url, data.displayUrl) || localPathToUrl(data.localPath);
  }
  return firstString(data.displayUrl, data.url, data.imageUrl) || localPathToUrl(data.localPath);
}

export async function resolveAsset(nodeData) {
  const data = normalizeNodeData(nodeData);
  const embedded = getEmbeddedAsset(data);
  if (embedded) return embedded;
  return fetchAsset(data.assetId);
}

export async function resolveAssetUrl(nodeData, options = {}) {
  const data = normalizeNodeData(nodeData);
  const asset = await resolveAsset(data);
  const assetUrl = firstString(asset?.url);
  if (assetUrl) return assetUrl;
  return resolveLegacyUrl(data, options);
}

export async function preloadAssets(assetIds) {
  const ids = [];
  const seen = new Set();
  for (const value of Array.isArray(assetIds) ? assetIds : []) {
    const id = normalizeAssetId(value);
    if (!id || seen.has(id) || assetCache.has(id) || failedAssetIds.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return [];
  try {
    const response = await fetch('/api/v2/assets/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds: ids }),
    });
    if (!response || !response.ok) {
      ids.forEach((id) => failedAssetIds.add(id));
      return [];
    }
    const payload = await response.json();
    const assets = Array.isArray(payload?.assets) ? payload.assets : [];
    const normalized = [];
    for (const item of assets) {
      const asset = normalizeAssetPayload(item);
      if (!asset) continue;
      assetCache.set(asset.assetId, asset);
      normalized.push(asset);
    }
    const returned = new Set(normalized.map((asset) => asset.assetId));
    ids.forEach((id) => {
      if (!returned.has(id)) failedAssetIds.add(id);
    });
    return normalized;
  } catch {
    ids.forEach((id) => failedAssetIds.add(id));
    return [];
  }
}

export function __resetAssetResolverForTest() {
  assetCache.clear();
  failedAssetIds.clear();
}