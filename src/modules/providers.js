import { isCustomProviderId, normalizeCustomProvidersRegistry } from '../../api/customProviderRegistry.js';
import {
  getCustomProviderRuntimeState,
  getModelManifest,
  getModelsByKind,
} from '../manifests/index.js';

const DISPLAY_NAME_OVERRIDES = {
  'minimax/minimax-m2.5-highspeed': 'MiniMax M2.5-highspeed',
  'qwen/qwen3.5-397b-a17b': 'Qwen3.5-397B-A17B',
  'deepseek/deepseek-v3.2': 'DeepSeek-V3.2',
  'moonshotai/kimi-k2.5': 'Kimi K2.5',
  'apimart/gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
  'apimart/gemini-3-flash-preview-nothinking': 'Gemini 3 Flash (No Thinking)',
  'gpt-image-2': 'GPT image 2',
  'gpt-image-2-vip': 'GPT image 2',
  'nano-banana': 'Nanobanana',
  'nano-banana-fast': 'Nanobanana',
  'nano-banana-pro': 'NanobananaPRO',
  'nano-banana-pro-vt': 'NanobananaPRO',
  'nano-banana-pro-cl': 'NanobananaPRO',
  'nano-banana-pro-vip': 'NanobananaPRO',
  'nano-banana-pro-4k-vip': 'NanobananaPRO',
  'nano-banana-2': 'Nanobanana2',
  'nano-banana-2-cl': 'Nanobanana2',
  'nano-banana-2-4k-cl': 'Nanobanana2',
  'apimart/gpt-5.4': 'GPT-5.4',
  'seedance-2.0-fast': 'Seedance 2.0 Fast',
  'seedance-2.0': 'Seedance 2.0',
  'aicanvas/text-lite': 'AICanvas Text Lite',
  'aicanvas/text-pro': 'AICanvas Text Pro',
  'aicanvas/image-lite': 'AICanvas Image Lite',
  'aicanvas/image-pro': 'AICanvas Image Pro',
};

export const PROVIDERS_META = {
  grsai: {
    id: 'grsai',
    label: 'GRSAI',
    defaultUrl: 'https://grsai.dakka.com.cn',
    logoPath: 'images/grsai.png',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultUrl: 'https://api.openai.com',
    logoPath: null,
  },
  apimart: {
    id: 'apimart',
    label: 'APIMart',
    defaultUrl: 'https://api.apimart.ai',
    logoPath: null,
  },
  volcengine: {
    id: 'volcengine',
    label: '火山方舟',
    defaultUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    logoPath: 'images/volcengine.svg',
  },
  runninghub: {
    id: 'runninghub',
    label: 'RunningHUB',
    defaultUrl: 'https://www.runninghub.cn',
    logoPath: 'images/RH.png',
  },
  runninghubwf: {
    id: 'runninghubwf',
    label: 'RunningHUB工作流',
    defaultUrl: 'https://www.runninghub.cn',
    logoPath: 'images/RH.png',
  },
  dreamina: {
    id: 'dreamina',
    label: '即梦',
    defaultUrl: '',
    logoPath: null,
  },
  aicanvas: {
    id: 'aicanvas',
    label: 'AICanvas',
    defaultUrl: '',
    logoPath: 'images/favicon.svg',
  },
};

function normalizeText(value) {
  return String(value || '').trim();
}

function dedupeCustomProviders(customProviders = []) {
  const merged = new Map();
  for (const provider of customProviders) {
    const providerId = normalizeText(provider?.id);
    if (!providerId) {
      continue;
    }
    merged.set(providerId, provider);
  }
  return [...merged.values()];
}

function resolveRuntimeCustomProviders() {
  const runtimeState = getCustomProviderRuntimeState();
  return Array.isArray(runtimeState?.customProviders) ? runtimeState.customProviders : [];
}

function resolveEffectiveCustomProviders(customProviders = []) {
  return dedupeCustomProviders(
    normalizeCustomProvidersRegistry([
      ...resolveRuntimeCustomProviders(),
      ...(Array.isArray(customProviders) ? customProviders : []),
    ]),
  );
}

function buildCustomProviderMeta(customProvider) {
  return {
    id: customProvider.id,
    label: customProvider.label || customProvider.id,
    defaultUrl: '',
    logoPath: null,
    kind: customProvider.kind || 'openai-compatible',
    enabled: customProvider.enabled !== false,
    capabilities: Array.isArray(customProvider.capabilities)
      ? [...customProvider.capabilities]
      : [],
  };
}

export function getDisplayModelName(modelId) {
  if (!modelId) {
    return '';
  }

  const manifest = getModelManifest(modelId);
  if (manifest?.displayName) {
    return manifest.displayName;
  }

  return DISPLAY_NAME_OVERRIDES[modelId] || modelId;
}

export function listProviderMeta(customProviders = []) {
  const builtInProviders = Object.values(PROVIDERS_META);
  const runtimeCustomProviders = resolveEffectiveCustomProviders(customProviders).map(
    buildCustomProviderMeta,
  );
  return [...builtInProviders, ...runtimeCustomProviders];
}

export function getProviderMeta(providerId, customProviders = []) {
  const normalizedProviderId = normalizeText(providerId);
  if (!normalizedProviderId) {
    return null;
  }
  return (
    PROVIDERS_META[normalizedProviderId] ||
    listProviderMeta(customProviders).find(provider => provider.id === normalizedProviderId) ||
    null
  );
}

export function getAllProviderIds(customProviders = []) {
  return listProviderMeta(customProviders).map(provider => provider.id);
}

export function getProviderBadgeText(providerLike, fallback = 'AI') {
  const label = normalizeText(
    typeof providerLike === 'string'
      ? getProviderMeta(providerLike)?.label || providerLike
      : providerLike?.label || providerLike?.id,
  );
  if (!label) {
    return fallback;
  }

  const asciiToken = label
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(token => token[0])
    .join('')
    .toUpperCase();
  if (asciiToken) {
    return asciiToken.slice(0, 2);
  }

  return label.replace(/\s+/g, '').slice(0, 2) || fallback;
}

export function isRuntimeCustomProviderId(providerId) {
  return isCustomProviderId(providerId);
}

export function listCustomProviderModelsByKind(kind) {
  const normalizedKind = normalizeText(kind);
  return getModelsByKind(normalizedKind).filter(manifest =>
    isRuntimeCustomProviderId(manifest?.provider),
  );
}

export function listCustomProviderModelGroupsByKind(kind) {
  const normalizedKind = normalizeText(kind);
  const groups = new Map();

  for (const manifest of listCustomProviderModelsByKind(normalizedKind)) {
    const providerId = normalizeText(manifest?.provider);
    if (!providerId) {
      continue;
    }

    const existing = groups.get(providerId) || {
      id: providerId,
      provider: providerId,
      meta: getProviderMeta(providerId),
      models: [],
    };
    existing.models.push(manifest);
    groups.set(providerId, existing);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      label: group.meta?.label || group.id,
      subtitle:
        group.meta?.label && normalizedKind
          ? `${group.meta.label} · ${normalizedKind}`
          : group.meta?.label || group.id,
      models: [...group.models].sort((left, right) =>
        getDisplayModelName(left?.modelId).localeCompare(
          getDisplayModelName(right?.modelId),
          'zh-CN',
        ),
      ),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}