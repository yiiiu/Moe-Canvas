import { buildBodyFromMapping } from './adapters/modelApiMappingEngine.js';
import { isCustomProviderId } from './customProviderRegistry.js';
import { requester } from './requester.js';
import { localPathToUrl, pickResultLocalPath } from '../src/utils/localMediaPath.js';
import { resolveModelExecution } from '../src/manifests/index.js';

const CUSTOM_AUDIO_TIMEOUT_MS = 10 * 60 * 1000;
const SAVE_OUTPUT_TIMEOUT_MS = 8 * 60 * 1000;
const JSON_CONTENT_TYPE_RE = /application\/json|text\/json/i;
const AUDIO_CONTENT_TYPE_RE = /^audio\//i;
const AUDIO_EXTENSION_BY_CONTENT_TYPE = Object.freeze({
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
});

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(value) {
  return normalizeText(value).replace(/\/+$/, '');
}

function normalizeProviderHint(payload = {}) {
  return normalizeText(payload.provider).toLowerCase();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildPrompt(payload = {}) {
  const directPrompt = normalizeText(payload.prompt);
  if (directPrompt) {
    return directPrompt;
  }

  const textInputs = Array.isArray(payload.textInputs)
    ? payload.textInputs.map(normalizeText).filter(Boolean)
    : [];
  return textInputs.join('\n').trim();
}

function stripProviderPrefix(modelId, providerId) {
  const normalizedModelId = normalizeText(modelId);
  const normalizedProviderId = normalizeText(providerId);
  if (!normalizedModelId || !normalizedProviderId) {
    return normalizedModelId;
  }

  const prefix = `${normalizedProviderId}/`;
  if (normalizedModelId.startsWith(prefix)) {
    return normalizedModelId.slice(prefix.length);
  }
  return normalizedModelId;
}

function resolveWireModel(execution, payload = {}) {
  return (
    normalizeText(execution?.modelManifest?.extensions?.rawModelId) ||
    normalizeText(execution?.executionManifest?.model) ||
    stripProviderPrefix(payload.model, execution?.providerId) ||
    normalizeText(payload.model)
  );
}

function resolveOptionalAudioFields(payload = {}) {
  const generationParams = isPlainObject(payload.generationParams)
    ? payload.generationParams
    : {};

  const voice = normalizeText(payload.voice || generationParams.voice);
  const responseFormat = normalizeText(
    payload.responseFormat || payload.format || generationParams.responseFormat || generationParams.format,
  );
  const speedValue = payload.speed ?? generationParams.speed;
  const speed = Number(speedValue);

  return {
    ...(voice ? { voice } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(Number.isFinite(speed) ? { speed } : {}),
  };
}

function guessAudioExtensionFromContentType(contentType = '') {
  const normalizedContentType = normalizeText(contentType).toLowerCase().split(';')[0];
  return AUDIO_EXTENSION_BY_CONTENT_TYPE[normalizedContentType] || 'mp3';
}

function extractAudioUrlsFromObject(value) {
  const results = [];
  const visited = new WeakSet();
  const candidateKeys = new Set([
    'url',
    'audio_url',
    'audioUrl',
    'download_url',
    'downloadUrl',
    'fileUrl',
    'mediaUrl',
  ]);

  const walk = current => {
    if (current == null) {
      return;
    }

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    if (typeof current === 'string') {
      const url = normalizeText(current);
      if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
        results.push(url);
      }
      return;
    }

    if (typeof current !== 'object') {
      return;
    }

    if (visited.has(current)) {
      return;
    }
    visited.add(current);

    for (const [key, nestedValue] of Object.entries(current)) {
      if (candidateKeys.has(key)) {
        walk(nestedValue);
        continue;
      }
      if (nestedValue && typeof nestedValue === 'object') {
        walk(nestedValue);
      }
    }
  };

  walk(value);

  return [...new Set(results.map(normalizeText).filter(Boolean))];
}

async function saveAudioBlob(blob, extension = 'mp3') {
  const params = new URLSearchParams({ ext: extension || 'mp3' });
  const result = await requester({
    url: `/api/v2/save_output?${params.toString()}`,
    method: 'POST',
    provider: 'local',
    timeout: SAVE_OUTPUT_TIMEOUT_MS,
    headers: {
      'Content-Type': blob?.type || 'application/octet-stream',
    },
    body: blob,
  });

  const localPath = pickResultLocalPath(result);
  return {
    localPath,
    audioUrl: localPathToUrl(localPath) || '',
  };
}

async function saveAudioFromUrl(url, extension = 'mp3', dedupeKey = '') {
  const result = await requester({
    url: '/api/v2/save_output_from_url',
    method: 'POST',
    provider: 'local',
    timeout: SAVE_OUTPUT_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      ext: extension || 'mp3',
      maxBytes: 1024 * 1024 * 1024,
      ...(dedupeKey ? { dedupeKey } : {}),
    }),
  });

  const localPath = pickResultLocalPath(result);
  return {
    localPath,
    audioUrl: localPathToUrl(localPath) || url,
  };
}

function buildAudioResultItems(items = []) {
  return items
    .map(item => ({
      ...(item.localPath ? { localPath: item.localPath } : {}),
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      audioUrl: item.audioUrl,
    }))
    .filter(item => normalizeText(item.audioUrl));
}

async function normalizeJsonAudioResult(responseJson, request) {
  const urls = extractAudioUrlsFromObject(responseJson);
  if (urls.length === 0) {
    throw new Error('音频任务创建成功但未返回音频地址');
  }

  const requestedFormat = normalizeText(
    request?.body?.response_format || request?.body?.format || request?.meta?.responseFormat,
  );
  const dedupeRoot = normalizeText(request?.meta?.dedupeKey || request?.meta?.executionId || request?.meta?.model);

  const savedItems = [];
  for (const [index, url] of urls.entries()) {
    const saved = await saveAudioFromUrl(url, requestedFormat || 'mp3', `${dedupeRoot}:${index}`);
    savedItems.push({
      audioUrl: saved.audioUrl || url,
      localPath: saved.localPath || '',
      sourceUrl: url,
    });
  }

  const audios = buildAudioResultItems(savedItems);
  return {
    audioUrl: audios[0]?.audioUrl || urls[0],
    ...(audios[0]?.localPath ? { localPath: audios[0].localPath } : {}),
    isBatch: audios.length > 1,
    audios,
  };
}

async function normalizeBlobAudioResult(blob, headers, request) {
  const contentType = normalizeText(headers?.get?.('content-type') || blob?.type || '');

  if (JSON_CONTENT_TYPE_RE.test(contentType)) {
    const text = await blob.text();
    const parsed = JSON.parse(text || '{}');
    return normalizeJsonAudioResult(parsed, request);
  }

  const extension = guessAudioExtensionFromContentType(contentType);
  const saved = await saveAudioBlob(blob, extension);
  if (!saved.audioUrl) {
    throw new Error('音频结果保存失败');
  }

  return {
    audioUrl: saved.audioUrl,
    ...(saved.localPath ? { localPath: saved.localPath } : {}),
    isBatch: false,
    audios: buildAudioResultItems([
      {
        audioUrl: saved.audioUrl,
        localPath: saved.localPath || '',
      },
    ]),
  };
}

export function resolveCustomAudioManifestExecution(payload = {}) {
  const modelId = normalizeText(payload.model);
  if (!modelId) {
    return null;
  }

  const providerHint = normalizeProviderHint(payload);
  const execution = resolveModelExecution(modelId, {
    providerHint,
  });

  const executionManifest = execution?.executionManifest;
  const modelManifest = execution?.modelManifest;
  const providerId = normalizeText(modelManifest?.provider || executionManifest?.provider || providerHint);

  if (!executionManifest || !modelManifest) {
    return null;
  }
  if (executionManifest.adapterType !== 'modelApi' || executionManifest.kind !== 'audio') {
    return null;
  }
  if (!isCustomProviderId(providerId)) {
    return null;
  }

  return {
    ...execution,
    providerId,
  };
}

export async function buildCustomAudioManifestRequest(payload = {}, { getProviderConfig } = {}) {
  if (typeof getProviderConfig !== 'function') {
    return null;
  }

  const execution = resolveCustomAudioManifestExecution(payload);
  if (!execution) {
    return null;
  }

  const providerConfig = getProviderConfig(execution.providerId) || {};
  const apiUrl = normalizeBaseUrl(payload.apiUrl || providerConfig.apiUrl);
  const apiKey = normalizeText(payload.apiKey || providerConfig.apiKey);
  const prompt = buildPrompt(payload);

  if (!apiUrl) {
    throw new Error(`API URL 未配置（厂商：${execution.providerId}）`);
  }
  if (!apiKey) {
    throw new Error(`API Key 未配置（厂商：${execution.providerId}）`);
  }
  if (!prompt) {
    throw new Error('音频生成缺少文本内容');
  }

  const modelToken = resolveWireModel(execution, payload);
  const context = {
    provider: execution.providerId,
    modelManifest: execution.modelManifest,
    executionManifest: execution.executionManifest,
    payload,
    finalPrompt: prompt,
    modelToken,
    model: modelToken,
    apiKey,
    ctx: {
      getProviderConfig,
    },
    inputImages: [],
    inputVideos: [],
    inputAudios: [],
  };

  const mappedBody = await buildBodyFromMapping({
    bodyMapping: execution.executionManifest.bodyMapping,
    context,
    transforms: {},
  });

  const body = {
    ...(!Object.prototype.hasOwnProperty.call(mappedBody, 'input') ? { input: prompt } : {}),
    ...mappedBody,
    ...resolveOptionalAudioFields(payload),
  };

  const endpoint = normalizeText(execution.executionManifest.endpoint);
  if (!endpoint) {
    throw new Error(`音频 manifest 缺少 endpoint（厂商：${execution.providerId}）`);
  }

  return {
    url: '/api/v2/proxy/image',
    headers: execution.executionManifest.headers || {
      'Content-Type': 'application/json',
    },
    body: {
      apiUrl: `${apiUrl}${endpoint}`,
      apiKey,
      ...body,
    },
    meta: {
      provider: execution.providerId,
      model: normalizeText(payload.model),
      executionId: execution.executionManifest.id,
      audioRoute: 'manifest',
      customAudioManifest: true,
      responseType: 'blob',
      responseFormat: body.response_format || '',
      adapterTrace: {
        source: 'manifest',
        executionId: execution.executionManifest.id,
        modelId: normalizeText(payload.model),
      },
    },
  };
}

export async function executeCustomAudioManifestRequest(request, options = {}) {
  const meta = isPlainObject(request?.meta) ? request.meta : {};
  if (!meta.customAudioManifest) {
    return null;
  }

  const providerId = normalizeText(meta.provider) || 'unknown';
  const requestBody = isPlainObject(request?.body) ? request.body : {};
  const apiUrl = normalizeText(requestBody.apiUrl);
  const apiKey = normalizeText(requestBody.apiKey);

  if (!apiUrl) {
    throw new Error(`API URL 未配置（厂商：${providerId}）`);
  }
  if (!apiKey) {
    throw new Error(`API Key 未配置（厂商：${providerId}）`);
  }

  const { apiUrl: _discardApiUrl, apiKey: _discardApiKey, ...wireBody } = requestBody;
  const headers = {
    ...(isPlainObject(request?.headers) ? request.headers : {}),
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  const response = await requester({
    url: apiUrl,
    method: 'POST',
    provider: providerId,
    timeout: CUSTOM_AUDIO_TIMEOUT_MS,
    signal: options?.signal,
    headers,
    body: JSON.stringify(wireBody),
    responseType: 'blob',
    returnMeta: true,
  });

  const result = await normalizeBlobAudioResult(response?.data, response?.headers, {
    ...request,
    meta: {
      ...meta,
      dedupeKey: `${providerId}:${normalizeText(meta.model || '')}`,
    },
  });

  return {
    ...result,
    adapterTrace: meta.adapterTrace || undefined,
  };
}