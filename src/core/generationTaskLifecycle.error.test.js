import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGenerationFailurePatch } from './generationTaskLifecycle.js';

test('generationTaskLifecycle formats structured failure errors as readable text', () => {
  assert.equal(
    buildGenerationFailurePatch({
      error: { error: { message: 'Upstream rejected aspect ratio' } },
    }).jobError,
    'Upstream rejected aspect ratio',
  );
  assert.equal(
    buildGenerationFailurePatch({
      error: { error_message: 'Invalid resolution' },
    }).jobError,
    'Invalid resolution',
  );
  assert.notEqual(
    buildGenerationFailurePatch({
      error: { error: { message: 'Readable error' } },
    }).jobError,
    '[object Object]',
  );
});