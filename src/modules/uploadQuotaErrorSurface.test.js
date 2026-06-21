import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const DISALLOWED_GENERIC_UPLOAD_FAILURES = [
  {
    file: 'src/modules/app/resourceEntry.js',
    pattern: /window\[[^\]]+\]\('上传失败，请重试'\)/,
  },
  {
    file: 'src/components/SourceImageNode.js',
    pattern: /alert\(_0x1f22e5\(0x23a\)\)/,
  },
  {
    file: 'src/components/SourceVideoNode.js',
    pattern: /window\['showToast'\]\('上传失败，请重试'\)/,
  },
  {
    file: 'src/components/SourceAudioNode.js',
    pattern: /window\[[^\]]+\]\('上传失败，请重试'\)/,
  },
];

const DISALLOWED_DEFAULT_ERROR_TOASTS = [
  {
    file: 'src/modules/app/resourceEntry.js',
    pattern: /window\[[^\]]+\]\([^;]*\?\.message\|\|'上传失败，请重试'\);/,
  },
  {
    file: 'src/components/SourceVideoNode.js',
    pattern: /window\['showToast'\]\([^;]*\?\.message\|\|'上传失败，请重试'\)/,
  },
  {
    file: 'src/components/SourceAudioNode.js',
    pattern: /window\[[^\]]+\]\([^;]*\?\.message\|\|'上传失败，请重试'\)/,
  },
];

test('upload quota errors are not replaced by generic retry text in direct upload surfaces', () => {
  for (const { file, pattern } of DISALLOWED_GENERIC_UPLOAD_FAILURES) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      source,
      pattern,
      `${file} should pass through the caught upload error message`,
    );
  }
});

test('upload quota errors are shown with error toast type in direct upload surfaces', () => {
  for (const { file, pattern } of DISALLOWED_DEFAULT_ERROR_TOASTS) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      source,
      pattern,
      `${file} should pass caught upload error messages to an error toast`,
    );
  }
});