import { PROVIDER_ERROR_CODES, createProviderError } from './providerErrors.js';

export class BaseProviderAdapter {
  constructor(config = {}) {
    this.config = config && typeof config === 'object' ? { ...config } : {};
  }

  async validateConfig() {
    throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED, 'Provider adapter method is not implemented.');
  }

  async testConnection() {
    throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED, 'Provider adapter method is not implemented.');
  }

  async submitChatCompletion() {
    throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED, 'Provider adapter method is not implemented.');
  }

  async normalizeChatResult() {
    throw createProviderError(PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED, 'Provider adapter method is not implemented.');
  }
}