import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { showToast } from './toastService.js';

function createElementMock(tagName) {
  return {
    tagName,
    children: [],
    className: '',
    textContent: '',
    classList: {
      add() {}
    },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    remove() {
      this.removed = true;
    }
  };
}

test('toast error style reuses the existing light error pill tokens', () => {
  const rootCss = readFileSync(join(process.cwd(), 'style.css'), 'utf8');
  const toastCss = readFileSync(join(process.cwd(), 'styles', 'toast.css'), 'utf8');
  const errorToastRulePattern = /\.v2-toast\.error\s*\{[^}]*background:\s*var\(--fill-danger-soft\)[^}]*border-color:\s*var\(--error-border\)[^}]*color:\s*var\(--error-text-light\)/;

  assert.match(rootCss, errorToastRulePattern);
  assert.match(toastCss, errorToastRulePattern);
  assert.doesNotMatch(rootCss, /--toast-error-bg/);
  assert.doesNotMatch(toastCss, /--toast-error-bg/);
});

test('toastService formats structured object messages as readable text', () => {
  const wrap = createElementMock('div');
  const previousDocument = globalThis.document;

  globalThis.document = {
    getElementById(id) {
      return id === 'v2-toast-wrap' ? wrap : null;
    },
    createElement: createElementMock
  };

  try {
    showToast({
      error: {
        message: 'Invalid URL (POST /v1/videos/generations)',
        type: 'invalid_request_error'
      }
    }, 'error', 0);

    const toast = wrap.children[0];
    const messageEl = toast.children[1];

    assert.equal(messageEl.textContent, 'Invalid URL (POST /v1/videos/generations)');
    assert.notEqual(messageEl.textContent, '[object Object]');
  } finally {
    globalThis.document = previousDocument;
  }
});