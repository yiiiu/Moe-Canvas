import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAsyncTaskLoadingToCanvasData,
  canRestoreAsyncTaskLoading,
  installAsyncTaskLoadingRecovery,
  restoreAsyncTaskLoadingRecords,
} from './asyncTaskRuntime.js';

const baseNode = {
  id: 'node-1',
  canvasId: 'canvas-1',
  isGenerating: false,
};

function activeRecord(overrides = {}) {
  return {
    runtimeTaskId: 'runtime-1',
    clientTaskId: 'client-1',
    kind: 'image',
    provider: 'apimart',
    nodeId: 'node-1',
    canvasId: 'canvas-1',
    status: 'polling',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test('asyncTaskRuntime: remote poll provider restores loading only with queryable task id', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    queryableTaskId: 'poll-1',
    pollingTaskId: 'poll-1',
  }), baseNode), true);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    remoteTaskId: 'result-or-meta-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), false);
});

test('asyncTaskRuntime: GRSAI local proxy recovery uses local credentials, not remote result id', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    remoteTaskId: 'grsai-result-id',
    remoteResultId: 'grsai-result-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), true);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: '',
    clientTaskId: '',
    remoteTaskId: 'grsai-result-id',
    remoteResultId: 'grsai-result-id',
    pollingTaskId: '',
    queryableTaskId: '',
  }), baseNode), false);
});

test('asyncTaskRuntime: terminal node or completed record is not restored to loading', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
    status: 'success',
  }), baseNode), false);

  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
  }), {
    ...baseNode,
    imageUrl: 'https://cdn.example/result.png',
  }), false);
});

test('asyncTaskRuntime: node with restored image result is settled even when stale generating flag remains', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'grsai',
    runtimeTaskId: 'runtime-grsai-1',
    clientTaskId: 'client-grsai-1',
    pollingTaskId: '',
    queryableTaskId: '',
  }), {
    ...baseNode,
    isGenerating: true,
    generationStartTime: 100,
    generationDuration: null,
    asyncTaskStatus: 'running',
    imageUrl: '/output/restored-grsai.png',
    images: [{ imageUrl: '/output/restored-grsai.png' }],
  }), false);
});


test('asyncTaskRuntime: canvas hydration keeps existing generation timer start time', () => {
  const canvasData = {
    id: 'canvas-1',
    nodes: [{
      ...baseNode,
      isGenerating: true,
      jobStatus: 'loading',
      generationStartTime: 12000,
      asyncTaskStartedAt: 12000,
      asyncTaskStatus: 'running',
      asyncRuntimeTaskId: 'runtime-1',
      asyncClientTaskId: 'client-1',
    }],
  };
  const storage = {
    getItem: (key) => key === 'ai-canvas:async-tasks:v1' ? JSON.stringify({
      version: 1,
      items: [activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
        createdAt: 42000,
        updatedAt: 42000,
      })],
    }) : null,
  };

  const patched = applyAsyncTaskLoadingToCanvasData(canvasData, { storage, now: 43000 });
  const node = patched.nodes[0];

  assert.notEqual(patched, canvasData);
  assert.equal(node.generationStartTime, 12000);
  assert.equal(node.asyncTaskStartedAt, 12000);
  assert.equal(node.asyncTaskStatus, 'running');
});

test('asyncTaskRuntime: direct loading restore keeps existing generation timer start time', () => {
  const state = {
    nodes: {
      'node-1': {
        ...baseNode,
        isGenerating: true,
        jobStatus: 'loading',
        generationStartTime: 12000,
        asyncTaskStartedAt: 12000,
        asyncTaskStatus: 'running',
        asyncRuntimeTaskId: 'runtime-1',
        asyncClientTaskId: 'client-1',
      },
    },
  };
  const updates = [];
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      updates.push({ nodeId, patch });
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };

  const restored = restoreAsyncTaskLoadingRecords([
    activeRecord({
      provider: 'grsai',
      runtimeTaskId: 'runtime-1',
      clientTaskId: 'client-1',
      recoveryMode: 'local_proxy_poll',
      createdAt: 42000,
      updatedAt: 42000,
    }),
  ], { store });

  const node = state.nodes['node-1'];
  assert.equal(restored.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(node.generationStartTime, 12000);
  assert.equal(node.asyncTaskStartedAt, 12000);
  assert.equal(node.asyncTaskStatus, 'running');
});

test('asyncTaskRuntime: loading recovery installer retries overlay within one second after late DOM mount', () => {
  let now = 0;
  const intervals = [];
  const timeouts = [];
  const originalDateNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  function makeClassList(initial = '') {
    const values = new Set(String(initial || '').split(/\s+/).filter(Boolean));
    return {
      add: (...items) => items.forEach((item) => values.add(String(item))),
      remove: (...items) => items.forEach((item) => values.delete(String(item))),
      contains: (item) => values.has(String(item)),
      toString: () => [...values].join(' '),
    };
  }

  function makeElement(className = '') {
    const element = {
      className,
      classList: makeClassList(className),
      children: [],
      parentNode: null,
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
        element.parentNode = null;
      },
      querySelector(selector) {
        if (selector === '.img-loading-overlay') return element.children.find((child) => child.className === 'img-loading-overlay') || null;
        if (selector === '.img-node-preview') return element.children.find((child) => child.className === 'img-node-preview') || null;
        return null;
      },
      querySelectorAll(selector) {
        const found = element.querySelector(selector);
        return found ? [found] : [];
      },
      closest(selector) {
        return selector === '.v2-node' ? element : null;
      },
    };
    return element;
  }

  const preview = makeElement('img-node-preview');
  const nodeEl = makeElement('v2-node');
  nodeEl.appendChild(preview);
  const state = {
    nodes: {
      'node-1': {
        ...baseNode,
        isGenerating: true,
        jobStatus: 'loading',
        asyncRuntimeTaskId: 'runtime-1',
        asyncClientTaskId: 'client-1',
      },
    },
  };
  const storage = {
    getItem: (key) => key === 'ai-canvas:async-tasks:v1' ? JSON.stringify({
      version: 1,
      items: [activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
      })],
    }) : null,
  };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };
  let domMounted = false;

  Date.now = () => now;
  globalThis.setInterval = (fn, ms) => {
    const timer = { fn, ms, active: true };
    intervals.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { if (timer) timer.active = false; };
  globalThis.setTimeout = (fn, ms) => {
    const timer = { fn, ms, active: true };
    timeouts.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.active = false; };
  globalThis.window = { PREVIEW_MODE: false };
  globalThis.document = {
    body: makeElement('body'),
    createElement: () => makeElement(''),
    getElementById: (id) => (domMounted && id === 'node-1' ? nodeEl : null),
    querySelector: () => null,
  };

  try {
    const session = installAsyncTaskLoadingRecovery({
      store,
      storage,
      asyncTaskLoadingSource: 'test-overlay-delay',
      asyncTaskLoadingRetryDelays: [0],
      asyncTaskLoadingOverlayIntervalMs: 100,
      asyncTaskLoadingOverlayFastMs: 1000,
      asyncTaskLoadingWatchMs: 1000,
    });
    assert.equal(preview.querySelector('.img-loading-overlay'), null);

    domMounted = true;
    for (now = 100; now <= 1000; now += 100) {
      for (const interval of intervals) {
        if (interval.active) interval.fn();
      }
      for (const timeout of timeouts) {
        if (timeout.active && timeout.ms <= 50) {
          timeout.active = false;
          timeout.fn();
        }
      }
      if (preview.querySelector('.img-loading-overlay')) break;
    }

    assert.ok(preview.querySelector('.img-loading-overlay'));
    session.stop();
  } finally {
    Date.now = originalDateNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('asyncTaskRuntime: reused loading recovery install reruns with latest storage immediately', () => {
  const state = {
    nodes: {
      'node-1': { ...baseNode },
    },
  };
  const updates = [];
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      updates.push({ nodeId, patch });
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };
  const emptyStorage = {
    getItem: () => JSON.stringify({ version: 1, items: [] }),
  };
  const activeStorage = {
    getItem: (key) => key === 'ai-canvas:async-tasks:v1' ? JSON.stringify({
      version: 1,
      items: [activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
      })],
    }) : null,
  };

  const firstSession = installAsyncTaskLoadingRecovery({
    store,
    storage: emptyStorage,
    asyncTaskLoadingSource: 'test-empty-install',
    asyncTaskLoadingRetryDelays: [0],
    asyncTaskLoadingOverlayFastMs: 0,
    asyncTaskLoadingWatchMs: 0,
  });

  const secondSession = installAsyncTaskLoadingRecovery({
    store,
    storage: activeStorage,
    asyncTaskLoadingSource: 'test-active-install',
    asyncTaskLoadingRetryDelays: [0],
    asyncTaskLoadingOverlayFastMs: 0,
    asyncTaskLoadingWatchMs: 0,
  });

  try {
    assert.equal(secondSession, firstSession);
    assert.equal(updates.length, 1);
    assert.equal(state.nodes['node-1'].isGenerating, true);
    assert.equal(state.nodes['node-1'].asyncTaskStatus, 'running');
  } finally {
    firstSession.stop();
  }
});

test('asyncTaskRuntime: overlay recovery stays pending until loading element is actually mounted', () => {
  const timeouts = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  function makeClassList(initial = '') {
    const values = new Set(String(initial || '').split(/\s+/).filter(Boolean));
    return {
      add: (...items) => items.forEach((item) => values.add(String(item))),
      remove: (...items) => items.forEach((item) => values.delete(String(item))),
      contains: (item) => values.has(String(item)),
      toString: () => [...values].join(' '),
    };
  }

  function makeElement(className = '') {
    const element = {
      className,
      classList: makeClassList(className),
      children: [],
      parentNode: null,
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
        element.parentNode = null;
      },
      querySelector(selector) {
        if (selector === '.img-loading-overlay') return element.children.find((child) => child.className === 'img-loading-overlay') || null;
        if (selector === '.img-node-preview') return element.children.find((child) => child.className === 'img-node-preview') || null;
        return null;
      },
      querySelectorAll(selector) {
        const found = element.querySelector(selector);
        return found ? [found] : [];
      },
      closest(selector) {
        return selector === '.v2-node' ? element : null;
      },
    };
    return element;
  }

  const preview = makeElement('img-node-preview');
  const nodeEl = makeElement('v2-node');
  nodeEl.appendChild(preview);
  const state = {
    nodes: {
      'node-1': { ...baseNode },
    },
  };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };

  globalThis.setTimeout = (fn, ms) => {
    const timer = { fn, ms, active: true };
    timeouts.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.active = false; };
  globalThis.window = { PREVIEW_MODE: false };
  globalThis.document = {
    body: makeElement('body'),
    createElement: () => makeElement(''),
    getElementById: (id) => (id === 'node-1' ? nodeEl : null),
    querySelector: () => null,
  };

  try {
    const first = restoreAsyncTaskLoadingRecords([
      activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
      }),
    ], { store });

    assert.equal(first.length, 1);
    assert.equal(first[0].overlayRestored, false);
    assert.equal(preview.querySelector('.img-loading-overlay'), null);

    for (const timer of timeouts) {
      if (timer.active && timer.ms === 50) {
        timer.active = false;
        timer.fn();
      }
    }

    const second = restoreAsyncTaskLoadingRecords([
      activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
      }),
    ], { store });

    assert.equal(second.length, 1);
    assert.equal(second[0].overlayRestored, true);
    assert.ok(preview.querySelector('.img-loading-overlay'));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('asyncTaskRuntime: failed local async cache projects failure to node and clears stale success media', () => {
  const state = {
    nodes: {
      'node-1': {
        id: 'node-1',
        canvasId: 'canvas-1',
        isGenerating: false,
        jobStatus: 'success',
        asyncTaskStatus: 'success',
        asyncRuntimeTaskId: 'runtime-grsai-1',
        asyncClientTaskId: 'client-grsai-1',
        generationStartTime: 100,
        imageUrl: '/output/stale-success.png',
        sourceUrl: '/output/stale-success.png',
        thumbUrl: '/output/stale-thumb.png',
        localPath: 'output/stale-success.png',
        displayLocalPath: 'output/stale-success.png',
        images: [{ imageUrl: '/output/stale-success.png', localPath: 'output/stale-success.png' }],
      },
    },
  };
  const updates = [];
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      updates.push({ nodeId, patch });
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };

  const restored = restoreAsyncTaskLoadingRecords([
    activeRecord({
      provider: 'grsai',
      runtimeTaskId: 'runtime-grsai-1',
      clientTaskId: 'client-grsai-1',
      pollingTaskId: '',
      queryableTaskId: '',
      status: 'failed',
      error: '[GRSAI] guardrails failed (错误码: 400)',
      finishedAt: 1100,
    }),
  ], { store });

  const node = state.nodes['node-1'];
  assert.equal(restored.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(node.isGenerating, false);
  assert.equal(node.jobStatus, 'error');
  assert.equal(node.asyncTaskStatus, 'failed');
  assert.equal(node.jobError, '[GRSAI] guardrails failed (错误码: 400)');
  assert.equal(node.asyncRuntimeTaskId, null);
  assert.equal(node.asyncClientTaskId, null);
  assert.equal(node.imageUrl, null);
  assert.equal(node.sourceUrl, null);
  assert.equal(node.thumbUrl, null);
  assert.equal(node.localPath, null);
  assert.equal(node.displayLocalPath, null);
  assert.deepEqual(node.images, []);
});

test('asyncTaskRuntime: reused loading recovery install retries late overlay within one second', () => {
  let now = 0;
  const intervals = [];
  const timeouts = [];
  const originalDateNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  function makeClassList(initial = '') {
    const values = new Set(String(initial || '').split(/\s+/).filter(Boolean));
    return {
      add: (...items) => items.forEach((item) => values.add(String(item))),
      remove: (...items) => items.forEach((item) => values.delete(String(item))),
      contains: (item) => values.has(String(item)),
    };
  }

  function makeElement(className = '') {
    const element = {
      className,
      classList: makeClassList(className),
      children: [],
      parentNode: null,
      appendChild(child) {
        child.parentNode = element;
        element.children.push(child);
        return child;
      },
      remove() {
        if (!element.parentNode) return;
        element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
        element.parentNode = null;
      },
      querySelector(selector) {
        if (selector === '.img-loading-overlay') return element.children.find((child) => child.className === 'img-loading-overlay') || null;
        if (selector === '.img-node-preview') return element.children.find((child) => child.className === 'img-node-preview') || null;
        return null;
      },
      querySelectorAll(selector) {
        const found = element.querySelector(selector);
        return found ? [found] : [];
      },
      closest(selector) {
        return selector === '.v2-node' ? element : null;
      },
    };
    return element;
  }

  const preview = makeElement('img-node-preview');
  const nodeEl = makeElement('v2-node');
  nodeEl.appendChild(preview);
  const state = { nodes: { 'node-1': { ...baseNode } } };
  const store = {
    getState: () => state,
    updateNodeData(nodeId, patch) {
      state.nodes[nodeId] = { ...state.nodes[nodeId], ...patch };
    },
  };
  const emptyStorage = { getItem: () => JSON.stringify({ version: 1, items: [] }) };
  const activeStorage = {
    getItem: (key) => key === 'ai-canvas:async-tasks:v1' ? JSON.stringify({
      version: 1,
      items: [activeRecord({
        provider: 'grsai',
        runtimeTaskId: 'runtime-1',
        clientTaskId: 'client-1',
        recoveryMode: 'local_proxy_poll',
      })],
    }) : null,
  };
  let domMounted = false;

  Date.now = () => now;
  globalThis.setInterval = (fn, ms) => {
    const timer = { fn, ms, active: true };
    intervals.push(timer);
    return timer;
  };
  globalThis.clearInterval = (timer) => { if (timer) timer.active = false; };
  globalThis.setTimeout = (fn, ms) => {
    const timer = { fn, ms, active: true };
    timeouts.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => { if (timer) timer.active = false; };
  globalThis.window = { PREVIEW_MODE: false };
  globalThis.document = {
    body: makeElement('body'),
    createElement: () => makeElement(''),
    getElementById: (id) => (domMounted && id === 'node-1' ? nodeEl : null),
    querySelector: () => null,
  };

  try {
    const firstSession = installAsyncTaskLoadingRecovery({
      store,
      storage: emptyStorage,
      asyncTaskLoadingSource: 'test-reused-empty',
      asyncTaskLoadingRetryDelays: [0],
      asyncTaskLoadingOverlayFastMs: 0,
      asyncTaskLoadingWatchMs: 0,
    });
    const secondSession = installAsyncTaskLoadingRecovery({
      store,
      storage: activeStorage,
      asyncTaskLoadingSource: 'test-reused-active-late-dom',
      asyncTaskLoadingRetryDelays: [0],
      asyncTaskLoadingOverlayIntervalMs: 100,
      asyncTaskLoadingOverlayFastMs: 1000,
      asyncTaskLoadingWatchMs: 1000,
    });
    assert.equal(secondSession, firstSession);
    assert.equal(preview.querySelector('.img-loading-overlay'), null);

    domMounted = true;
    for (now = 100; now <= 1000; now += 100) {
      for (const interval of intervals) {
        if (interval.active) interval.fn();
      }
      for (const timeout of timeouts) {
        if (timeout.active && timeout.ms <= 50) {
          timeout.active = false;
          timeout.fn();
        }
      }
      if (preview.querySelector('.img-loading-overlay')) break;
    }

    assert.ok(preview.querySelector('.img-loading-overlay'));
    firstSession.stop();
  } finally {
    Date.now = originalDateNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('asyncTaskRuntime: expired active record is not restored to loading', () => {
  assert.equal(canRestoreAsyncTaskLoading(activeRecord({
    provider: 'apimart',
    pollingTaskId: 'poll-1',
    queryableTaskId: 'poll-1',
    expiresAt: 900,
  }), baseNode, { now: 1000 }), false);
});
