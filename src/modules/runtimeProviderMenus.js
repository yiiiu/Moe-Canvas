import { getModelsByKind } from '../manifests/index.js';
import {
  getDisplayModelName,
  getProviderBadgeText,
  getProviderMeta,
  isRuntimeCustomProviderId,
  listCustomProviderModelGroupsByKind,
} from './providers.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inferModelSubtitle(manifest, providerLabel) {
  return normalizeText(manifest?.description) || providerLabel || normalizeText(manifest?.provider);
}

function buildCustomProviderModelItem(manifest, group) {
  const providerLabel = group?.label || getProviderMeta(manifest?.provider)?.label || manifest?.provider;
  return Object.freeze({
    modelId: manifest.modelId,
    provider: manifest.provider,
    title: getDisplayModelName(manifest.modelId),
    subtitle: inferModelSubtitle(manifest, providerLabel),
    providerLabel,
    rawModelId:
      normalizeText(manifest?.extensions?.rawModelId) ||
      normalizeText(manifest?.aliases?.[0]) ||
      normalizeText(manifest?.modelId),
  });
}

export function buildRuntimeProviderBadgeHTML(providerId, size = 14, extraClass = '') {
  const meta = getProviderMeta(providerId);
  const label = meta?.label || providerId || 'AI';
  const badge = getProviderBadgeText({ id: providerId, label }, 'AI');
  const className = [
    Number(size) <= 12 ? 'text-model-icon-small' : 'text-model-icon',
    'text-model-icon-badge',
    'custom-provider-badge',
    extraClass,
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${className}">${escapeHtml(badge)}</div>`;
}

export function getRuntimeCustomProviderMenuGroups(kind) {
  return listCustomProviderModelGroupsByKind(kind).map(group => ({
    ...group,
    badgeHtml: buildRuntimeProviderBadgeHTML(group.provider, 14),
    smallBadgeHtml: buildRuntimeProviderBadgeHTML(group.provider, 12),
    models: group.models.map(model => buildCustomProviderModelItem(model, group)),
  }));
}

export function getRuntimeCustomProviderMenuItems(kind) {
  return getRuntimeCustomProviderMenuGroups(kind).flatMap(group => group.models);
}

export function hasRuntimeCustomProviderModels(kind) {
  return getRuntimeCustomProviderMenuGroups(kind).length > 0;
}

export function findRuntimeCustomProviderMenuItem(kind, modelId) {
  const normalizedModelId = normalizeText(modelId);
  if (!normalizedModelId) {
    return null;
  }

  return (
    getRuntimeCustomProviderMenuItems(kind).find(item => item.modelId === normalizedModelId) ||
    null
  );
}

export function getRuntimeCustomProviderIds(kind) {
  return getRuntimeCustomProviderMenuGroups(kind).map(group => group.provider);
}

export function isRuntimeCustomModel(manifestOrModelId, kind = '') {
  if (typeof manifestOrModelId === 'string') {
    const modelId = normalizeText(manifestOrModelId);
    if (!modelId) {
      return false;
    }
    return getModelsByKind(kind || '').some(
      manifest => manifest.modelId === modelId && isRuntimeCustomProviderId(manifest.provider),
    );
  }

  return isRuntimeCustomProviderId(manifestOrModelId?.provider);
}