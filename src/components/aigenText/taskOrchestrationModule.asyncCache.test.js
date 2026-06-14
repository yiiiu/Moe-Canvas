import test from 'node:test';
import assert from 'node:assert/strict';

import { createAIGenTextNodeTaskOrchestrationModule } from './taskOrchestrationModule.js';
import { loadAsyncTaskRecords } from '../../core/asyncTaskStore.js';
import { __resetGenerationTaskRuntimeForTest } from '../../core/generationTaskRuntime.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function createStore(nodes = {}) {
  const state = {
    nodes: { ...nodes },
    activeCanvasId: 'canvas_1',
  };
  return {
    getState: () => state,
    getStateRaw: () => state,
    getIncomingEdges: () => [],
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...(state.nodes[nodeId] || { id: nodeId }), ...patch };
    },
  };
}

function createTextNode(text = '') {
  return {
    nodeType: globalThis.Node.TEXT_NODE,
    textContent: text,
  };
}

function createPromptElement(text = '') {
  return {
    childNodes: [createTextNode(text)],
  };
}

test('aigenText orchestration: normal completion writes terminal async cache record', async () => {
  __resetGenerationTaskRuntimeForTest();
  const originalNode = globalThis.Node;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  globalThis.window = { showToast() {} };
  globalThis.localStorage = storage;

  const store = createStore({
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      canvasId: 'canvas_1',
      model: 'gpt-5.4',
      provider: 'custom',
    },
  });
  const api = {
    generateText: async () => ({
      id: 'resp_text_1',
      text: '文本生成完成',
      model: 'gpt-5.4',
    }),
  };
  const prototype = createAIGenTextNodeTaskOrchestrationModule({
    store,
    api,
    getDisplayModelName: () => 'gpt-5.4',
    ensureThumbDecoded: async () => {},
    revealRefThumbMedia: () => {},
    commit: () => {},
    TEXT_TOOLBAR_HTML: '',
    bindTextToolbarEvents: () => {},
    getPromptPresets: () => [],
    openCustomPresetsManager: () => {},
    startLoading: () => {},
    stopLoading: () => {},
    bindRefThumbHoverPreview: () => {},
    checkSlashTrigger: () => {},
    handleSlashKeyboardNavigation: () => {},
    closeSlashMenu: () => {},
    activateMenuKeyboard: () => {},
    _checkAtTrigger: () => {},
    _populateMentionMenu: () => {},
    _handleMentionMenuKeyboard: () => {},
    _handlePillKeyboard: () => {},
    _rehydratePromptPills: () => {},
    _handlePillHover: () => {},
    _handlePillOut: () => {},
    _syncEdgesOrderFromPills: () => {},
    _syncPillLabels: () => {},
    getCustomTextModels: () => [],
    saveCustomTextModels: () => {},
  });
  const node = Object.create(prototype);
  Object.assign(node, {
    nodeId: 'text-node-1',
    promptEl: createPromptElement('生成一句话'),
    _data: {
      model: 'gpt-5.4',
      provider: 'custom',
    },
    _updateSubmitButtonState: () => {},
    _renderOutputText: () => {},
  });

  try {
    const result = await node._onGenerate();
    const records = loadAsyncTaskRecords({ storage });

    assert.equal(result.status, 'success');
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'text');
    assert.equal(records[0].status, 'success');
    assert.equal(records[0].remoteResultId, 'resp_text_1');
    assert.equal(records[0].resultSpec.outputText, '文本生成完成');
  } finally {
    __resetGenerationTaskRuntimeForTest();
    globalThis.Node = originalNode;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
  }
});