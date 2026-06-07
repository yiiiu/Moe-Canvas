import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, parseError } from './index.js';

test('errors: parseError extracts nested error.message before stringifying objects', () => {
  const error = parseError('custom', {
    error: {
      message: 'Invalid URL (POST /v1/videos/generations)',
      type: 'invalid_request_error',
      param: '',
      code: ''
    }
  }, 400);

  assert.ok(error instanceof ApiError);
  assert.equal(error.message, 'Invalid URL (POST /v1/videos/generations)');
  assert.notEqual(error.message, '[object Object]');
});

test('errors: ApiError constructor formats object messages defensively', () => {
  const error = new ApiError({
    type: 'UNKNOWN',
    provider: 'custom',
    message: {
      error: {
        message: 'Nested provider error'
      }
    }
  });

  assert.equal(error.message, 'Nested provider error');
  assert.notEqual(error.message, '[object Object]');
});