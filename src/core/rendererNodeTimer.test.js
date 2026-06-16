import test from 'node:test';
import assert from 'node:assert/strict';

import { getNodeTimerRenderState } from './rendererNodeTimer.js';

test('renderer timer does not keep ticking for terminal nodes with stale start time', () => {
  const state = getNodeTimerRenderState(
    {
      id: 'text-node-1',
      type: 'ai-text',
      isGenerating: false,
      jobStatus: 'success',
      asyncTaskStatus: 'success',
      textTaskStatus: 'success',
      generationStartTime: 1000,
      generationDuration: null,
    },
    { now: 101000 },
  );

  assert.deepEqual(state, {
    visible: false,
    running: false,
    text: '',
  });
});

test('renderer timer still ticks for active nodes with a start time', () => {
  const state = getNodeTimerRenderState(
    {
      id: 'text-node-2',
      type: 'ai-text',
      isGenerating: true,
      jobStatus: 'loading',
      asyncTaskStatus: 'running',
      textTaskStatus: 'running',
      generationStartTime: 1000,
      generationDuration: null,
    },
    { now: 11400 },
  );

  assert.deepEqual(state, {
    visible: true,
    running: true,
    text: '10.4s',
  });
});

test('renderer timer hides stable finished duration on node badge', () => {
  const state = getNodeTimerRenderState(
    {
      id: 'text-node-3',
      type: 'ai-text',
      isGenerating: false,
      jobStatus: 'success',
      asyncTaskStatus: 'success',
      textTaskStatus: 'success',
      generationStartTime: 1000,
      generationDuration: 7000,
    },
    { now: 101000 },
  );

  assert.deepEqual(state, {
    visible: false,
    running: false,
    text: '',
  });
});