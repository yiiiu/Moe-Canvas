import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIGenerateNodeUiModule } from './uiModule.js';

function createFakeElement(tagName = 'div') {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    style: {},
    innerHTML: '',
  };
}

function withFakeDocument(run) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: createFakeElement,
  };
  try {
    return run();
  } finally {
    globalThis.document = originalDocument;
  }
}

function createUiModule() {
  return createAIGenerateNodeUiModule({
    store: {
      getState: () => ({ nodes: {}, edges: {} }),
    },
  });
}

test('aigenImage ui: failed status card renders red error style instead of neutral white', () => {
  withFakeDocument(() => {
    const ui = createUiModule();
    const card = ui._createStatusCard('Proxy upstream returned HTTP 400', 400);

    assert.equal(card.className, 'gen-status-card');
    assert.match(card.innerHTML, /var\(--red|var\(--danger|var\(--error/i);
    assert.doesNotMatch(card.innerHTML, /stroke="var\(--white-80\)"/);
    assert.doesNotMatch(card.innerHTML, /color:var\(--white-80\)/);
  });
});

test('aigenImage ui: successful status code keeps green success style', () => {
  withFakeDocument(() => {
    const ui = createUiModule();
    const card = ui._createStatusCard('生成完成', 0);

    assert.equal(card.className, 'gen-status-card');
    assert.match(card.innerHTML, /var\(--green/);
  });
});