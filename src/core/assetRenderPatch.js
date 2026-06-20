import {
  resolveAsset,
  __resetAssetResolverForTest,
} from './assetResolver.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
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

function normalizeKind(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('video')) return 'video';
  if (text.includes('audio')) return 'audio';
  return 'image';
}

function resolveKind(data, options) {
  return normalizeKind(options?.kind || data.mediaType || data.outputType || data.type);
}

function createPrimaryPatch(kind, url) {
  if (kind === 'video') return { videoUrl: url, url };
  if (kind === 'audio') return { audioUrl: url, src: url };
  return { imageUrl: url, src: url };
}

function hasAssetInput(data) {
  return Boolean(asObject(data.asset)?.url || data.assetId);
}

export async function buildResolvedAssetRenderPatch(nodeData, options = {}) {
  const data = normalizeNodeData(nodeData);
  if (!hasAssetInput(data)) return null;
  const asset = await resolveAsset(data);
  const url = firstString(asset?.url);
  if (!url) return null;
  return {
    ...createPrimaryPatch(resolveKind(data, options), url),
    asset,
    assetId: firstString(asset.assetId, data.assetId),
  };
}

export async function mergeResolvedAssetRenderPatch(nodeData, options = {}) {
  const patch = await buildResolvedAssetRenderPatch(nodeData, options);
  if (!patch) return nodeData;
  if (asObject(nodeData?.data)) {
    return {
      ...nodeData,
      data: {
        ...nodeData.data,
        ...patch,
      },
    };
  }
  return {
    ...nodeData,
    ...patch,
  };
}

export function __resetAssetRenderPatchForTest() {
  __resetAssetResolverForTest();
}