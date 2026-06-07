import { CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT, listCustomProviderRuntimeModelManifests } from '../manifests/index.js';
import appStore from '../core/stores/appStore.js';
import { isRuntimeCustomProviderId } from './providers.js';
import { buildTextProviderMenuGroupsHTML } from '../components/aigenText/apimartTextModelMenu.js';
import { bindNodeSubmenus } from '../components/shared/nodeFooterControls.js';

const MODEL_MENU_SELECTORS = [
  '.node-model-menu',
  '.img-model-menu',
  '.floating-menu[class*="model-menu"]',
  '.node-model-submenu',
  '.runtime-custom-submenu',
  '[data-lazy-model-menu]',
  '.lazy-model-menu',
  '.img-model-menu-lazy-anchor',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function inferNodeModelKind(nodeData) {
  const type = normalizeText(nodeData?.type).toLowerCase();
  if (type.includes('text') || type.includes('storyboard')) {
    return 'text';
  }
  if (type.includes('image') || type.includes('img')) {
    return 'image';
  }
  if (type.includes('video')) {
    return 'video';
  }
  if (type.includes('audio')) {
    return 'audio';
  }
  return '';
}

function getProviderFromModelId(modelId) {
  const normalizedModelId = normalizeText(modelId);
  const slashIndex = normalizedModelId.indexOf('/');
  return slashIndex > 0 ? normalizedModelId.slice(0, slashIndex) : '';
}

function getRawModelFromModelId(modelId) {
  const normalizedModelId = normalizeText(modelId);
  const slashIndex = normalizedModelId.indexOf('/');
  return slashIndex > 0 ? normalizedModelId.slice(slashIndex + 1) : normalizedModelId;
}

export function buildActiveCustomProviderSelectionIndex(
  manifests = listCustomProviderRuntimeModelManifests(),
) {
  const byKind = new Map();
  const all = {
    providers: new Set(),
    modelIds: new Set(),
    providerModels: new Set(),
  };

  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    const provider = normalizeText(manifest?.provider);
    const modelId = normalizeText(manifest?.modelId);
    const kind = normalizeText(manifest?.kind);
    if (!provider || !isRuntimeCustomProviderId(provider) || !modelId) {
      continue;
    }

    const rawModel =
      normalizeText(manifest?.extensions?.rawModelId) ||
      normalizeText(manifest?.aliases?.[0]) ||
      getRawModelFromModelId(modelId);
    const bucket = byKind.get(kind) || {
      providers: new Set(),
      modelIds: new Set(),
      providerModels: new Set(),
    };

    for (const target of [all, bucket]) {
      target.providers.add(provider);
      target.modelIds.add(modelId);
      target.providerModels.add(`${provider}\u0000${modelId}`);
      if (rawModel) {
        target.providerModels.add(`${provider}\u0000${rawModel}`);
      }
    }

    byKind.set(kind, bucket);
  }

  return { all, byKind };
}

const MODEL_KINDS = new Set(['text', 'image', 'video', 'audio']);
const EMPTY_SELECTION_BUCKET = Object.freeze({
  providers: new Set(),
  modelIds: new Set(),
  providerModels: new Set(),
});

function getSelectionBucket(index, kind) {
  const normalizedKind = normalizeText(kind);
  if (MODEL_KINDS.has(normalizedKind)) {
    return index?.byKind?.get?.(normalizedKind) || EMPTY_SELECTION_BUCKET;
  }
  return index?.all || EMPTY_SELECTION_BUCKET;
}

function isCustomProviderSelectionStale({ provider, model, kind }, index) {
  const normalizedProvider = normalizeText(provider);
  const normalizedModel = normalizeText(model);
  const modelProvider = getProviderFromModelId(normalizedModel);
  const effectiveProvider = normalizedProvider || modelProvider;

  if (!isRuntimeCustomProviderId(effectiveProvider) && !isRuntimeCustomProviderId(modelProvider)) {
    return false;
  }

  const bucket = getSelectionBucket(index, kind);
  if (!effectiveProvider || !bucket.providers.has(effectiveProvider)) {
    return true;
  }

  if (!normalizedModel) {
    return true;
  }

  return !(
    bucket.modelIds.has(normalizedModel) ||
    bucket.providerModels.has(`${effectiveProvider}\u0000${normalizedModel}`)
  );
}

function setEmptyIfPresentAndCustomish(patch, nodeData, key, providerHint = '') {
  if (!Object.prototype.hasOwnProperty.call(nodeData || {}, key)) {
    return;
  }

  const value = normalizeText(nodeData?.[key]);
  if (
    isRuntimeCustomProviderId(value) ||
    isRuntimeCustomProviderId(providerHint) ||
    isRuntimeCustomProviderId(getProviderFromModelId(value))
  ) {
    patch[key] = '';
  }
}

export function getStaleCustomProviderSelectionPatch(
  nodeData,
  index = buildActiveCustomProviderSelectionIndex(),
) {
  if (!nodeData || typeof nodeData !== 'object') {
    return null;
  }

  const kind = inferNodeModelKind(nodeData);
  const provider =
    normalizeText(nodeData.provider) ||
    normalizeText(nodeData.selectedProvider) ||
    normalizeText(nodeData.modelProvider) ||
    normalizeText(nodeData.apiProvider);
  const model =
    normalizeText(nodeData.model) ||
    normalizeText(nodeData.selectedModel) ||
    normalizeText(nodeData.modelId);

  if (!isCustomProviderSelectionStale({ provider, model, kind }, index)) {
    return null;
  }

  const effectiveProvider = provider || getProviderFromModelId(model);
  const patch = {};
  for (const key of ['provider', 'selectedProvider', 'modelProvider', 'apiProvider']) {
    setEmptyIfPresentAndCustomish(patch, nodeData, key, effectiveProvider);
  }
  for (const key of ['model', 'selectedModel', 'modelId']) {
    setEmptyIfPresentAndCustomish(patch, nodeData, key, effectiveProvider);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export function collectStaleCustomProviderSelectionPatches(
  nodes,
  index = buildActiveCustomProviderSelectionIndex(),
) {
  const patches = {};
  for (const [nodeId, nodeData] of Object.entries(nodes || {})) {
    const patch = getStaleCustomProviderSelectionPatch(nodeData, index);
    if (patch) {
      patches[nodeId] = patch;
    }
  }
  return patches;
}

function clearStaleCustomProviderSelections() {
  const nodes = appStore?.getState?.()?.nodes || {};
  const patches = collectStaleCustomProviderSelectionPatches(nodes);
  const patchCount = Object.keys(patches).length;
  if (patchCount === 0 || typeof appStore?.updateNodesData !== 'function') {
    return 0;
  }
  appStore.updateNodesData(patches);
  return patchCount;
}

function getActiveModelFromMenu(menu) {
  const activeItem = menu?.querySelector?.('.floating-menu-item.active[data-value]');
  return activeItem?.dataset?.value || menu?.dataset?.activeModel || '';
}

export function isMountedTextModelMenu(menu) {
  if (!menu?.classList?.contains('node-model-menu') || !menu.querySelector) {
    return false;
  }

  const explicitKind = normalizeText(
    menu?.dataset?.nodeMenuKind || menu?.getAttribute?.('data-node-menu-kind'),
  ).toLowerCase();
  if (explicitKind) {
    return explicitKind === 'text';
  }

  const lazyKind = normalizeText(menu?.dataset?.lazyModelMenu).toLowerCase();
  if (lazyKind) {
    return lazyKind === 'text';
  }

  return Boolean(
    menu.querySelector(
      '.text-model-icon, .text-model-icon-small, .text-model-icon-badge, .custom-provider-menu-item',
    ),
  );
}

function refreshMountedTextModelMenus(root = document) {
  if (!root?.querySelectorAll) {
    return;
  }
  for (const menu of root.querySelectorAll('.node-model-menu')) {
    if (!isMountedTextModelMenu(menu)) {
      continue;
    }
    const activeModel = getActiveModelFromMenu(menu);
    menu.innerHTML = buildTextProviderMenuGroupsHTML(activeModel, { includeCustomProviders: true });
    bindNodeSubmenus(menu);
  }
}

function getRendererBridge() {
  return globalThis?.window?.v2Renderer || null;
}

function closeAndInvalidateMountedModelMenus(root = document) {
  if (!root?.querySelectorAll) {
    return;
  }

  const selector = MODEL_MENU_SELECTORS.join(', ');
  for (const element of root.querySelectorAll(selector)) {
    element.classList?.remove('show', 'active');
    if (element.matches?.('.node-model-menu, .img-model-menu, .floating-menu[class*="model-menu"], .node-model-submenu, .runtime-custom-submenu')) {
      element.style.display = '';
      continue;
    }
    if (element.dataset) {
      delete element.dataset.lazyModelMenu;
    }
    element.innerHTML = '';
  }
}

function collectMountedNodeIds() {
  const renderer = getRendererBridge();
  const ids = new Set();

  if (renderer?.nodeInstances instanceof Map) {
    for (const nodeId of renderer.nodeInstances.keys()) {
      if (nodeId) {
        ids.add(nodeId);
      }
    }
  }

  if (renderer?.wrapperMap instanceof Map) {
    for (const [nodeId, wrapper] of renderer.wrapperMap.entries()) {
      if (nodeId && wrapper?.isConnected) {
        ids.add(nodeId);
      }
    }
  }

  return [...ids];
}

function flushMountedNodes() {
  const renderer = getRendererBridge();
  const ids = collectMountedNodeIds();
  if (ids.length === 0 || typeof renderer?.flushNodes !== 'function') {
    return false;
  }
  return renderer.flushNodes(ids);
}

export function refreshCustomProviderRuntimeMenus() {
  clearStaleCustomProviderSelections();
  closeAndInvalidateMountedModelMenus();
  refreshMountedTextModelMenus();
  flushMountedNodes();
}

export function installCustomProviderRuntimeMenuRefresh() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const onRuntimeChanged = () => {
    refreshCustomProviderRuntimeMenus();
  };

  window.addEventListener(CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT, onRuntimeChanged);
  return () => window.removeEventListener(CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT, onRuntimeChanged);
}