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
  const taskCenterTasks = new Map();
  const taskCenterManager = {
    upserts: [],
    tasks: taskCenterTasks,
    upsertTask(task) {
      this.upserts.push(task);
      this.tasks.set(task.taskId, { ...(this.tasks.get(task.taskId) || {}), ...task });
      return task;
    },
  };
  globalThis.window = {
    showToast() {},
    __aiCanvasTaskCenterManager: taskCenterManager,
  };
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
  let capturedPayload = null;
  const api = {
    generateText: async (payload) => {
      capturedPayload = payload;
      return {
        id: 'resp_text_1',
        text: '文本生成完成',
        model: 'gpt-5.4',
      };
    },
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
    assert.match(capturedPayload.runtimeTaskId, /^async:text:custom:/);
    assert.equal(capturedPayload.clientTaskId, `client:${capturedPayload.runtimeTaskId}`);
    assert.equal(capturedPayload.nodeId, 'text-node-1');
    assert.equal(capturedPayload.canvasId, 'canvas_1');
    assert.equal(capturedPayload.kind, 'text');
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, 'text');
    assert.equal(records[0].status, 'success');
    assert.equal(records[0].remoteResultId, 'resp_text_1');
    assert.equal(records[0].resultSpec.outputText, '文本生成完成');
    assert.equal(taskCenterManager.upserts.some((task) => task.kind === 'textGeneration' && task.status === 'processing' && task.unifiedTask.kind === 'text'), true);
    assert.equal(taskCenterManager.upserts.some((task) => task.kind === 'textGeneration' && task.status === 'complete' && task.unifiedTask.status === 'success'), true);
    assert.equal(taskCenterTasks.get('generation:text-node-1').status, 'complete');
    assert.equal(taskCenterTasks.get('generation:text-node-1').recoverySpec.recoveryMode, 'local_proxy_poll');
  } finally {
    __resetGenerationTaskRuntimeForTest();
    globalThis.Node = originalNode;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
  }
});

test('aigenText orchestration: local proxy network interruption remains resumable instead of terminal failed', async () => {
  __resetGenerationTaskRuntimeForTest();
  const originalNode = globalThis.Node;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  const taskCenterManager = {
    upserts: [],
    tasks: new Map(),
    upsertTask(task) {
      this.upserts.push(task);
      this.tasks.set(task.taskId, { ...(this.tasks.get(task.taskId) || {}), ...task });
      return task;
    },
  };
  globalThis.window = {
    showToast() {},
    __aiCanvasTaskCenterManager: taskCenterManager,
  };
  globalThis.localStorage = storage;

  const store = createStore({
    'text-node-1': {
      id: 'text-node-1',
      type: 'ai-text',
      canvasId: 'canvas_1',
      model: 'custom_openai_compatible/gpt-5.4',
      provider: 'custom_openai_compatible',
    },
  });
  const api = {
    generateText: async () => {
      throw new Error('[custom_openai_compatible] 网络连接失败，请检查网络或代理设置');
    },
  };
  const prototype = createAIGenTextNodeTaskOrchestrationModule({
    store,
    api,
    getDisplayModelName: () => 'custom_openai_compatible/gpt-5.4',
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
    promptEl: createPromptElement('生成vlog，5000字'),
    _data: {
      model: 'custom_openai_compatible/gpt-5.4',
      provider: 'custom_openai_compatible',
    },
    _updateSubmitButtonState: () => {},
    _renderOutputText: () => {},
  });

  try {
    const result = await node._onGenerate();
    const [record] = loadAsyncTaskRecords({ storage });
    const task = taskCenterManager.tasks.get('generation:text-node-1');

    assert.equal(result.status, 'paused');
    assert.equal(record.kind, 'text');
    assert.equal(record.status, 'polling');
    assert.equal(record.recoveryMode, 'local_proxy_poll');
    assert.equal(record.canResume, true);
    assert.match(record.runtimeTaskId, /^async:text:custom_openai_compatible:/);
    assert.equal(record.clientTaskId, `client:${record.runtimeTaskId}`);
    assert.equal(task.status, 'processing');
    assert.equal(task.unifiedTask.status, 'polling');
    assert.equal(task.recoverySpec.recoveryMode, 'local_proxy_poll');
  } finally {
    __resetGenerationTaskRuntimeForTest();
    globalThis.Node = originalNode;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalStorage;
  }
});