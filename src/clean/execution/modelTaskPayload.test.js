import test from 'node:test';
import assert from 'node:assert/strict';

import { openaiChatManifest } from '../models/manifests/openaiChatManifest.js';
import {
  ModelExecutionError,
  MODEL_EXECUTION_ERROR_CODES,
} from './modelExecutionErrors.js';
import { buildModelTaskPayload } from './modelTaskPayload.js';

function assertModelExecutionError(action, code) {
  assert.throws(
    action,
    (error) => error instanceof ModelExecutionError && error.code === code,
  );
}

test('buildModelTaskPayload creates payload from valid manifest and input', () => {
  const payload = buildModelTaskPayload({
    manifest: openaiChatManifest,
    input: {
      prompt: 'Write a concise plan.',
    },
    context: {
      taskId: 'task-fixed-1',
      source: 'unit-test',
    },
  });

  assert.equal(payload.taskId, 'task-fixed-1');
  assert.equal(payload.modelId, 'openai-compatible-chat');
  assert.equal(payload.provider, 'openai-compatible');
  assert.equal(payload.type, 'text');
  assert.equal(payload.input.prompt, 'Write a concise plan.');
  assert.equal(payload.input.temperature, 0.7);
  assert.equal(payload.input.maxTokens, 2048);
  assert.deepEqual(payload.context, {
    taskId: 'task-fixed-1',
    source: 'unit-test',
  });
  assert.equal(typeof payload.createdAt, 'string');
});

test('buildModelTaskPayload lets input override manifest defaults', () => {
  const payload = buildModelTaskPayload({
    manifest: openaiChatManifest,
    input: {
      prompt: 'Write a caption.',
      temperature: 0.2,
      maxTokens: 128,
    },
    context: {
      taskId: 'task-fixed-2',
    },
  });

  assert.equal(payload.input.temperature, 0.2);
  assert.equal(payload.input.maxTokens, 128);
});

test('buildModelTaskPayload rejects missing manifest', () => {
  assertModelExecutionError(
    () => buildModelTaskPayload({ manifest: null, input: {}, context: {} }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_INVALID_MANIFEST,
  );
});

test('buildModelTaskPayload rejects missing required prompt', () => {
  assertModelExecutionError(
    () => buildModelTaskPayload({
      manifest: openaiChatManifest,
      input: {},
      context: {},
    }),
    MODEL_EXECUTION_ERROR_CODES.MODEL_TASK_INPUT_MISSING,
  );
});

test('buildModelTaskPayload prefers context taskId', () => {
  const payload = buildModelTaskPayload({
    manifest: openaiChatManifest,
    input: {
      prompt: 'Write a title.',
    },
    context: {
      taskId: 'existing-task-id',
    },
  });

  assert.equal(payload.taskId, 'existing-task-id');
});

test('buildModelTaskPayload preserves project, canvas and node context', () => {
  const payload = buildModelTaskPayload({
    manifest: openaiChatManifest,
    input: {
      prompt: 'Write a summary.',
    },
    context: {
      taskId: 'context-task-id',
      projectId: 'project-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
    },
  });

  assert.deepEqual(payload.context, {
    taskId: 'context-task-id',
    projectId: 'project-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
  });
});