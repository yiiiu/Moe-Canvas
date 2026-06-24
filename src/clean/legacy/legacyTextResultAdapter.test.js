import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEGACY_TEXT_ERROR_CODES,
  LegacyTextResultError,
} from './legacyTextErrors.js';
import {
  assertLegacyTextResult,
  toLegacyTextResult,
} from './legacyTextResultAdapter.js';

test('toLegacyTextResult maps clean text into legacy success contract', () => {
  const cleanResult = {
    manifestId: 'openai-compatible-chat',
    taskId: 'task-clean-text',
    status: 'succeeded',
    text: 'Clean text output',
    result: { text: 'Clean text output', usage: { totalTokens: 12 } },
    raw: { id: 'raw-clean-result' },
  };

  const legacyResult = toLegacyTextResult(cleanResult);

  assert.deepEqual(legacyResult, {
    success: true,
    text: 'Clean text output',
    outputText: 'Clean text output',
    taskId: 'task-clean-text',
    raw: { id: 'raw-clean-result' },
    normalizedResult: { text: 'Clean text output', usage: { totalTokens: 12 } },
    source: 'clean-runtime',
  });
});

test('toLegacyTextResult trims clean text before mapping text fields', () => {
  const legacyResult = toLegacyTextResult({
    text: '  trimmed output  ',
  });

  assert.equal(legacyResult.text, 'trimmed output');
  assert.equal(legacyResult.outputText, 'trimmed output');
});

test('toLegacyTextResult rejects empty text with LEGACY_TEXT_EMPTY_RESULT', () => {
  assert.throws(
    () => toLegacyTextResult({ text: '   ' }),
    (error) => error instanceof LegacyTextResultError
      && error.code === LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_EMPTY_RESULT
      && error.toLegacyResult().success === false
      && error.toLegacyResult().source === 'clean-runtime',
  );
});

test('toLegacyTextResult rejects non-object clean results with LEGACY_TEXT_BAD_RESULT', () => {
  assert.throws(
    () => toLegacyTextResult(null),
    (error) => error instanceof LegacyTextResultError
      && error.code === LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_RESULT,
  );
});

test('assertLegacyTextResult accepts legacy success contract', () => {
  const result = {
    success: true,
    text: 'Legacy text',
    outputText: 'Legacy text',
    source: 'clean-runtime',
  };

  assert.equal(assertLegacyTextResult(result), result);
});

test('assertLegacyTextResult rejects success=true without text', () => {
  assert.throws(
    () => assertLegacyTextResult({
      success: true,
      outputText: 'Only outputText',
      source: 'clean-runtime',
    }),
    (error) => error instanceof LegacyTextResultError
      && error.code === LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_RESULT,
  );
});

test('assertLegacyTextResult rejects success=true without outputText', () => {
  assert.throws(
    () => assertLegacyTextResult({
      success: true,
      text: 'Only text',
      source: 'clean-runtime',
    }),
    (error) => error instanceof LegacyTextResultError
      && error.code === LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_BAD_RESULT,
  );
});

test('assertLegacyTextResult accepts legacy error contract', () => {
  const result = {
    success: false,
    error: 'Clean result is empty.',
    code: LEGACY_TEXT_ERROR_CODES.LEGACY_TEXT_EMPTY_RESULT,
    source: 'clean-runtime',
  };

  assert.equal(assertLegacyTextResult(result), result);
});