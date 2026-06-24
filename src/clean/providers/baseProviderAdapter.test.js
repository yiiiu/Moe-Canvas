import test from 'node:test';
import assert from 'node:assert/strict';

import { BaseProviderAdapter } from './baseProviderAdapter.js';
import { PROVIDER_ERROR_CODES, ProviderError } from './providerErrors.js';

async function assertProviderError(action, code) {
  await assert.rejects(
    action,
    (error) => error instanceof ProviderError && error.code === code,
  );
}

test('BaseProviderAdapter default methods throw PROVIDER_NOT_IMPLEMENTED', async () => {
  const adapter = new BaseProviderAdapter({});

  await assertProviderError(() => adapter.validateConfig(), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.testConnection(), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitChatCompletion({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitImageGeneration({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitVideoGeneration({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitAudioGeneration({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.submitMultimodal({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
  await assertProviderError(() => adapter.normalizeChatResult({}), PROVIDER_ERROR_CODES.PROVIDER_NOT_IMPLEMENTED);
});