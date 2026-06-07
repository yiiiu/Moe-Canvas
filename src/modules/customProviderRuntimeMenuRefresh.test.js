import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActiveCustomProviderSelectionIndex,
  collectStaleCustomProviderSelectionPatches,
  getStaleCustomProviderSelectionPatch,
} from './customProviderRuntimeMenuRefresh.js';

function createManifest({ provider = 'custom_acme', modelId = 'custom_acme/gpt-4o-mini', rawModelId = 'gpt-4o-mini', kind = 'text' } = {}) {
  return {
    provider,
    modelId,
    kind,
    aliases: [rawModelId],
    extensions: { rawModelId },
  };
}

test('custom provider runtime refresh: keeps active custom provider selection', () => {
  const index = buildActiveCustomProviderSelectionIndex([createManifest()]);

  assert.equal(
    getStaleCustomProviderSelectionPatch(
      {
        id: 'text-1',
        type: 'ai-text',
        provider: 'custom_acme',
        model: 'custom_acme/gpt-4o-mini',
      },
      index,
    ),
    null,
  );

  assert.equal(
    getStaleCustomProviderSelectionPatch(
      {
        id: 'text-2',
        type: 'ai-text',
        provider: 'custom_acme',
        model: 'gpt-4o-mini',
      },
      index,
    ),
    null,
  );
});

test('custom provider runtime refresh: clears disabled custom provider selection', () => {
  const index = buildActiveCustomProviderSelectionIndex([]);

  assert.deepEqual(
    getStaleCustomProviderSelectionPatch(
      {
        id: 'text-1',
        type: 'ai-text',
        provider: 'custom_acme',
        model: 'custom_acme/gpt-4o-mini',
      },
      index,
    ),
    {
      provider: '',
      model: '',
    },
  );
});

test('custom provider runtime refresh: clears custom model when provider field is missing', () => {
  const index = buildActiveCustomProviderSelectionIndex([]);

  assert.deepEqual(
    getStaleCustomProviderSelectionPatch(
      {
        id: 'text-1',
        type: 'ai-text',
        model: 'custom_acme/gpt-4o-mini',
      },
      index,
    ),
    {
      model: '',
    },
  );
});

test('custom provider runtime refresh: does not clear built-in provider selection', () => {
  const index = buildActiveCustomProviderSelectionIndex([]);

  assert.equal(
    getStaleCustomProviderSelectionPatch(
      {
        id: 'text-1',
        type: 'ai-text',
        provider: 'apimart',
        model: 'apimart/gpt-5.5',
      },
      index,
    ),
    null,
  );
});

test('custom provider runtime refresh: collects node patches for stale selections only', () => {
  const index = buildActiveCustomProviderSelectionIndex([createManifest()]);

  assert.deepEqual(
    collectStaleCustomProviderSelectionPatches(
      {
        'text-active': {
          type: 'ai-text',
          provider: 'custom_acme',
          model: 'custom_acme/gpt-4o-mini',
        },
        'text-disabled': {
          type: 'ai-text',
          provider: 'custom_disabled',
          model: 'custom_disabled/gpt-5.5',
        },
        'image-built-in': {
          type: 'ai-image',
          provider: 'apimart',
          model: 'gpt-image-2',
        },
      },
      index,
    ),
    {
      'text-disabled': {
        provider: '',
        model: '',
      },
    },
  );
});