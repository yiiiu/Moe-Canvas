import { post, request } from './apiBase.js';
import { isCustomProviderId } from './customProviderRegistry.js';

const TEST_TIMEOUT_MS = 30000;
const STEP_LABELS = Object.freeze({
  config: '配置',
  model: '模型',
  balance: '余额',
  upload: '上传',
});
const CONNECTION_TEST_CAPABILITY = 'connection_test';
const TEXT_CAPABILITY = 'text';
const DEFAULT_COMPLETION_TEST_MESSAGE = '你好';
const DEFAULT_UPLOAD_SKIP_DETAIL = 'OpenAI-compatible 接口通常直接接收远程 URL，本轮不做统一上传探测。';
const DEFAULT_BALANCE_SKIP_DETAIL = '自定义 OpenAI-compatible 供应商暂不提供统一余额探测，本轮跳过。';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeProviderId(providerId) {
  return normalizeString(providerId).toLowerCase();
}

function normalizeBaseUrl(apiUrl) {
  return normalizeString(apiUrl).replace(/\/+$/g, '');
}

function trimSlashes(value) {
  return normalizeString(value).replace(/^\/+|\/+$/g, '');
}

function joinUrl(baseUrl, path) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = trimSlashes(path);
  if (!normalizedBaseUrl) {
    return normalizedPath;
  }
  if (!normalizedPath) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

function stripKnownOpenAiTail(apiUrl) {
  return normalizeBaseUrl(apiUrl)
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/completions$/i, '')
    .replace(/\/models$/i, '');
}

function buildModelsProbeUrl(apiUrl) {
  const strippedBaseUrl = stripKnownOpenAiTail(apiUrl);
  if (!strippedBaseUrl || strippedBaseUrl.includes(':generateContent')) {
    return '';
  }
  if (/\/v\d+(?:beta)?$/i.test(strippedBaseUrl) || /\/openai\/v1$/i.test(strippedBaseUrl)) {
    return joinUrl(strippedBaseUrl, 'models');
  }
  return joinUrl(strippedBaseUrl, 'v1/models');
}

function buildCompletionProbeUrl(apiUrl) {
  const strippedBaseUrl = stripKnownOpenAiTail(apiUrl);
  if (!strippedBaseUrl || strippedBaseUrl.includes(':generateContent')) {
    return '';
  }
  if (/\/chat\/completions$/i.test(normalizeBaseUrl(apiUrl))) {
    return normalizeBaseUrl(apiUrl);
  }
  if (/\/v\d+(?:beta)?$/i.test(strippedBaseUrl) || /\/openai\/v1$/i.test(strippedBaseUrl)) {
    return joinUrl(strippedBaseUrl, 'chat/completions');
  }
  return joinUrl(strippedBaseUrl, 'v1/chat/completions');
}

function buildLabelFromProviderId(providerId) {
  const base = normalizeString(providerId)
    .replace(/^custom[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) {
    return 'Custom Provider';
  }
  return base.replace(/\b\w/g, char => char.toUpperCase());
}

function resolveProviderLabel(providerId, customProvider) {
  return normalizeString(customProvider?.label) || buildLabelFromProviderId(providerId);
}

function normalizeCustomProviderRecord(providerId, providerConfig = {}, options = {}) {
  const customProvider = options?.customProvider || providerConfig?.customProvider || {};
  const capabilities = Array.isArray(customProvider.capabilities)
    ? customProvider.capabilities.map(value => normalizeString(value).toLowerCase()).filter(Boolean)
    : [];
  const textModels = Array.isArray(customProvider?.models?.text)
    ? customProvider.models.text.map(model => normalizeString(model)).filter(Boolean)
    : [];

  return {
    id: normalizeProviderId(customProvider.id || providerId),
    label: resolveProviderLabel(providerId, customProvider),
    kind: normalizeString(customProvider.kind || 'openai-compatible').toLowerCase(),
    enabled: customProvider.enabled !== false,
    capabilities,
    textModels,
    apiUrl: normalizeBaseUrl(providerConfig.apiUrl),
    apiKey: normalizeString(providerConfig.apiKey).replace(/^Bearer\s+/i, ''),
  };
}

function supportsConnectionTest(customProvider) {
  if (!Array.isArray(customProvider.capabilities) || customProvider.capabilities.length === 0) {
    return true;
  }
  return customProvider.capabilities.includes(CONNECTION_TEST_CAPABILITY);
}

function supportsTextFallback(customProvider) {
  if (!Array.isArray(customProvider.capabilities) || customProvider.capabilities.length === 0) {
    return customProvider.textModels.length > 0;
  }
  return customProvider.capabilities.includes(TEXT_CAPABILITY) && customProvider.textModels.length > 0;
}

function makeStep(id, ok, message, detail = '', { skipped = false, category = '' } = {}) {
  return {
    id,
    label: STEP_LABELS[id] || id,
    ok: Boolean(ok),
    skipped: skipped === true,
    message,
    detail,
    category,
  };
}

function pass(providerId, label, detail, steps) {
  return {
    ok: true,
    providerId,
    label,
    message: '通过',
    summary: '连接测试通过',
    detail,
    category: '',
    suggestion: '',
    steps,
  };
}

function fail(providerId, label, error, steps, category = 'provider_error') {
  const normalizedError = normalizeString(error) || '连接测试未通过';
  return {
    ok: false,
    providerId,
    label,
    message: '未通过',
    error: normalizedError,
    summary: normalizedError,
    category,
    suggestion: humanizeCategory(category, label, normalizedError),
    steps,
  };
}

function humanizeCategory(category, label, fallback = '连接测试未通过') {
  const messages = {
    missing_key: `${label} 的 API Key 还没填写。`,
    missing_url: `${label} 的接口地址未配置。`,
    auth_failed: `${label} 的 API Key 无效、过期，或没有访问权限。`,
    network_failed: `无法连到 ${label}，请检查网络、本地服务或防火墙。`,
    rate_limited: `${label} 返回限流，请稍后再试。`,
    model_unavailable: `${label} 的测试模型不可访问，可能未开通该模型或模型名不兼容。`,
    bad_base_url: `${label} 的接口地址不兼容，请检查 Base URL 是否填对。`,
    unsupported: `${label} 当前未启用连接测试能力。`,
    provider_error: `${label} 返回异常，请稍后重试或查看厂商后台状态。`,
  };
  return messages[category] || fallback;
}

function stringifyProbePayload(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function probeText(result = {}) {
  return [
    result.status ? `HTTP ${result.status}` : '',
    result.error || '',
    stringifyProbePayload(result.data),
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function summarizeFailure(result = {}, fallback = '连接测试未通过') {
  const text = probeText(result);
  if (!text) {
    return fallback;
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function isAuthFailure(result = {}) {
  const status = Number(result.status || 0);
  if (status === 401 || status === 403) {
    return true;
  }
  return /(?:\b401\b|\b403\b|unauthorized|forbidden|authentication|authorization|invalid\s+(?:api\s*)?key|invalid\s+token|api\s*key\s+invalid|apikey|bearer|access\s*token|鉴权|认证|未授权|无权限|密钥|令牌)/i.test(
    probeText(result).toLowerCase(),
  );
}

function classifyProbeFailure(result = {}, fallback = 'provider_error') {
  const status = Number(result.status || 0);
  const text = probeText(result).toLowerCase();
  if (isAuthFailure(result)) {
    return 'auth_failed';
  }
  if (status === 0 || /timeout|timed out|network|failed to fetch|dns|econn|请求超时|网络请求失败/i.test(text)) {
    return 'network_failed';
  }
  if (status === 429 || /rate limit|too many requests|限流|请求过于频繁/i.test(text)) {
    return 'rate_limited';
  }
  if (/model.+(?:not found|not exist|unavailable|no access)|模型.*(?:不存在|不可用|无权限|未开通)|no permission.*model/i.test(text)) {
    return 'model_unavailable';
  }
  if (status === 404 || /not found|invalid url|unsupported endpoint|cannot post|cannot get|接口地址|地址不兼容/i.test(text)) {
    return 'bad_base_url';
  }
  return fallback;
}

function isSuccessfulProbe(result = {}) {
  if (!result.success) {
    return false;
  }
  const status = Number(result.status || 0);
  if (status && (status < 200 || status >= 300)) {
    return false;
  }
  return !isAuthFailure(result);
}

async function getModelsProbe(probeUrl, apiKey) {
  return request(
    `/api/v2/proxy/task?apiUrl=${encodeURIComponent(probeUrl)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
    TEST_TIMEOUT_MS,
  );
}

async function runCompletionFallback(customProvider) {
  const model = customProvider.textModels[0];
  const completionUrl = buildCompletionProbeUrl(customProvider.apiUrl);
  if (!model || !completionUrl) {
    return null;
  }
  return post(
    '/api/v2/proxy/completions',
    {
      apiUrl: completionUrl,
      apiKey: customProvider.apiKey,
      model,
      stream: false,
      max_tokens: 1,
      messages: [{ role: 'user', content: DEFAULT_COMPLETION_TEST_MESSAGE }],
    },
    TEST_TIMEOUT_MS,
  );
}

function finishProviderResult(providerId, label, steps) {
  const failedStep = steps.find(step => !step.ok && !step.skipped);
  if (!failedStep) {
    const detail = steps.map(step => `${step.label}: ${step.message}`).join('；') || '连接测试通过';
    return pass(providerId, label, detail, steps);
  }
  return fail(providerId, label, failedStep.message, steps, failedStep.category || 'provider_error');
}

export async function testCustomProviderConnection(providerId, providerConfig = {}, options = {}) {
  const normalizedProviderId = normalizeProviderId(providerId);
  if (!isCustomProviderId(normalizedProviderId)) {
    return null;
  }

  const customProvider = normalizeCustomProviderRecord(normalizedProviderId, providerConfig, options);
  const steps = [];

  if (customProvider.kind && customProvider.kind !== 'openai-compatible') {
    steps.push(
      makeStep('config', false, `${customProvider.label} 当前协议不是 OpenAI-compatible。`, '', {
        category: 'unsupported',
      }),
    );
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  }

  if (!supportsConnectionTest(customProvider)) {
    steps.push(
      makeStep('config', false, `${customProvider.label} 当前未启用连接测试能力。`, '', {
        category: 'unsupported',
      }),
    );
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  }

  if (!customProvider.apiKey) {
    steps.push(makeStep('config', false, `${customProvider.label} 的 API Key 还没填写。`, '', { category: 'missing_key' }));
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  }

  if (!customProvider.apiUrl) {
    steps.push(makeStep('config', false, `${customProvider.label} 的接口地址未配置。`, '', { category: 'missing_url' }));
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  }

  steps.push(makeStep('config', true, '接口地址和 API Key 已填写。'));

  const modelsProbeUrl = buildModelsProbeUrl(customProvider.apiUrl);
  if (!modelsProbeUrl) {
    steps.push(makeStep('model', false, `${customProvider.label} 的接口地址不兼容，请检查 Base URL 是否填对。`, customProvider.apiUrl, {
      category: 'bad_base_url',
    }));
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  }

  const modelsProbeResult = await getModelsProbe(modelsProbeUrl, customProvider.apiKey);
  if (isSuccessfulProbe(modelsProbeResult)) {
    steps.push(makeStep('model', true, '模型列表可访问。', modelsProbeUrl));
  } else if (isAuthFailure(modelsProbeResult)) {
    const category = classifyProbeFailure(modelsProbeResult, 'auth_failed');
    steps.push(
      makeStep('model', false, humanizeCategory(category, customProvider.label), summarizeFailure(modelsProbeResult), {
        category,
      }),
    );
    return finishProviderResult(normalizedProviderId, customProvider.label, steps);
  } else {
    const canFallbackToText = supportsTextFallback(customProvider);
    if (!canFallbackToText) {
      const category = classifyProbeFailure(modelsProbeResult, 'model_unavailable');
      steps.push(
        makeStep(
          'model',
          false,
          `${customProvider.label} 的模型列表不可访问，且未提供可回退的文本模型。`,
          summarizeFailure(modelsProbeResult),
          { category },
        ),
      );
      return finishProviderResult(normalizedProviderId, customProvider.label, steps);
    }

    const completionFallbackResult = await runCompletionFallback(customProvider);
    if (completionFallbackResult && isSuccessfulProbe(completionFallbackResult)) {
      steps.push(
        makeStep(
          'model',
          true,
          `模型列表不可访问，已通过文本模型 ${customProvider.textModels[0]} 完成回退测试。`,
          summarizeFailure(modelsProbeResult),
        ),
      );
    } else {
      const category = classifyProbeFailure(completionFallbackResult || modelsProbeResult, 'model_unavailable');
      steps.push(
        makeStep(
          'model',
          false,
          humanizeCategory(category, customProvider.label),
          summarizeFailure(completionFallbackResult || modelsProbeResult),
          { category },
        ),
      );
      return finishProviderResult(normalizedProviderId, customProvider.label, steps);
    }
  }

  steps.push(makeStep('balance', true, '余额探测已跳过。', DEFAULT_BALANCE_SKIP_DETAIL, { skipped: true }));
  steps.push(makeStep('upload', true, '上传探测已跳过。', DEFAULT_UPLOAD_SKIP_DETAIL, { skipped: true }));

  return finishProviderResult(normalizedProviderId, customProvider.label, steps);
}