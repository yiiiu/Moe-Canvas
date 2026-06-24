import { BaseProviderAdapter } from './baseProviderAdapter.js';
import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.js';
import { PROVIDER_ERROR_CODES, createProviderError } from './providerErrors.js';

function normalizeProviderId(id) {
  return typeof id === 'string' ? id.trim() : '';
}

function isValidAdapterClass(adapterClass) {
  return typeof adapterClass === 'function' && adapterClass.prototype instanceof BaseProviderAdapter;
}

function adapterDisplayName(adapterClass) {
  return adapterClass.displayName || adapterClass.providerName || adapterClass.name || '';
}

export class ProviderRegistry {
  constructor(entries = []) {
    this.providers = new Map();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      this.registerProvider(entry.id, entry.adapterClass);
    }
  }

  registerProvider(id, adapterClass) {
    const providerId = normalizeProviderId(id);
    if (!providerId || !isValidAdapterClass(adapterClass)) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_INVALID_ADAPTER, 'Provider adapter class is invalid.', { id: providerId });
    }
    if (this.providers.has(providerId)) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_ALREADY_REGISTERED, 'Provider is already registered.', { id: providerId });
    }
    this.providers.set(providerId, adapterClass);
    return this;
  }

  hasProvider(id) {
    return this.providers.has(normalizeProviderId(id));
  }

  getProvider(id) {
    const providerId = normalizeProviderId(id);
    if (!this.providers.has(providerId)) {
      throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_NOT_FOUND, 'Provider is not registered.', { id: providerId });
    }
    return this.providers.get(providerId);
  }

  createProvider(id, config = {}) {
    const AdapterClass = this.getProvider(id);
    return new AdapterClass(config);
  }

  listProviders() {
    return [...this.providers.entries()].map(([id, adapterClass]) => ({
      id,
      name: adapterDisplayName(adapterClass),
      adapterClass,
    }));
  }
}

export function createDefaultProviderRegistry() {
  return new ProviderRegistry([
    {
      id: OpenAICompatibleAdapter.id,
      adapterClass: OpenAICompatibleAdapter,
    },
  ]);
}

export const defaultProviderRegistry = createDefaultProviderRegistry();