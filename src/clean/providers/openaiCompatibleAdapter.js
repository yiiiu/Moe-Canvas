import { BaseProviderAdapter } from './baseProviderAdapter.js';
import { createProviderResult } from './types.js';
import { PROVIDER_ERROR_CODES, ProviderError, createProviderError } from './providerErrors.js';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureNoTrailingSlash(value) {
  return text(value).replace(/\/+$/, '');
}

function defaultFetch() {
  return globalThis.fetch;
}

function errorMessageFromPayload(payload, fallback = '') {
  const source = payload && typeof payload === 'object' ? payload : {};
  const error = source.error && typeof source.error === 'object' ? source.error : {};
  return text(error.message) || text(source.message) || fallback;
}

function mapHttpStatusToProviderError(status, payload = {}) {
  const message = errorMessageFromPayload(payload, `Provider request failed with status ${status}.`);
  if (status === 401 || status === 403) {
    return createProviderError(PROVIDER_ERROR_CODES.PROVIDER_AUTH_FAILED, message, { status });
  }
  if (status === 429) {
    return createProviderError(PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMIT, message, { status });
  }
  return createProviderError(PROVIDER_ERROR_CODES.PROVIDER_BAD_RESPONSE, message, { status });
}

function mapFetchError(error) {
  if (error instanceof ProviderError) return error;
  const name = text(error?.name);
  const message = text(error?.message) || 'Provider request failed.';
  if (name === 'AbortError' || /timeout|timed out|aborted/i.test(message)) {
    return createProviderError(PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT, message);
  }
  return createProviderError(PROVIDER_ERROR_CODES.PROVIDER_BAD_RESPONSE, message);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (error) {
    throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_BAD_RESPONSE, 'Provider returned invalid JSON.', {
      cause: text(error?.message),
    });
  }
}

export class OpenAICompatibleAdapter extends BaseProviderAdapter {
  constructor(config = {}) {
    super(config);
    this.fetch = typeof config.fetch === 'function' ? config.fetch : defaultFetch();
  }

  async validateConfig() {
    const baseURL = text(this.config.baseURL);
    const apiKey = text(this.config.apiKey);
    const model = text(this.config.model);
    if (!baseURL) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING, 'Provider baseURL is required.', { field: 'baseURL' });
    }
    if (!apiKey) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING, 'Provider apiKey is required.', { field: 'apiKey' });
    }
    if (!model) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING, 'Provider model is required.', { field: 'model' });
    }
    if (typeof this.fetch !== 'function') {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING, 'Provider fetch implementation is required.', { field: 'fetch' });
    }
    return true;
  }

  async testConnection() {
    await this.validateConfig();
    const result = await this.submitChatCompletion({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
    });
    return { success: true, result };
  }

  async submitChatCompletion(input = {}) {
    await this.validateConfig();
    const body = {
      model: text(input.model) || text(this.config.model),
      messages: Array.isArray(input.messages) ? input.messages : [],
    };
    if (Number.isFinite(Number(input.temperature))) body.temperature = Number(input.temperature);
    if (Number.isFinite(Number(input.maxTokens))) body.max_tokens = Number(input.maxTokens);
    if (input.stream === true) body.stream = true;

    let response;
    try {
      response = await this.fetch(`${ensureNoTrailingSlash(this.config.baseURL)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${text(this.config.apiKey)}`,
          ...(this.config.headers && typeof this.config.headers === 'object' ? this.config.headers : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw mapFetchError(error);
    }

    const payload = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatusToProviderError(Number(response.status) || 0, payload);
    }
    return this.normalizeChatResult(payload);
  }

  normalizeChatResult(raw = {}) {
    const payload = raw && typeof raw === 'object' ? raw : {};
    const firstChoice = Array.isArray(payload.choices) && payload.choices.length ? payload.choices[0] : {};
    const message = firstChoice?.message && typeof firstChoice.message === 'object' ? firstChoice.message : {};
    const textValue = text(message.content) || text(firstChoice?.text) || text(payload.text) || text(payload.outputText);
    if (!textValue) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_BAD_RESPONSE, 'Provider response does not contain text output.');
    }
    return createProviderResult({
      id: text(payload.id),
      provider: 'openai-compatible',
      model: text(payload.model) || text(this.config.model),
      text: textValue,
      raw: payload,
      usage: payload.usage ?? null,
      finishReason: text(firstChoice?.finish_reason),
    });
  }
}