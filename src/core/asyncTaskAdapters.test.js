import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveAsyncTaskAdapter } from './asyncTaskAdapters.js';

test('asyncTaskAdapters resolves remote image adapter contract without fake cancel', () => {
  const adapter = resolveAsyncTaskAdapter({
    kind: 'image',
    provider: 'apimart',
    recoveryMode: 'remote_poll',
    pollingTaskId: 'poll-1',
    pollingSpec: {
      pollUrl: 'https://provider.example/tasks/{taskId}/status',
    },
    canCancel: true,
  });

  assert.equal(adapter.id, 'image:apimart:remote_poll');
  assert.equal(adapter.kind, 'image');
  assert.equal(adapter.provider, 'apimart');
  assert.equal(adapter.recoveryMode, 'remote_poll');
  assert.equal(adapter.canCancelRemote, false);
  assert.equal(adapter.canCancelLocal, false);
  assert.equal(typeof adapter.createPollRequest, 'function');
  assert.equal(typeof adapter.normalizePollResponse, 'function');
  assert.equal(typeof adapter.normalizeResult, 'function');
  assert.equal(adapter.writeNode, undefined);
  assert.equal(adapter.writeTaskCenter, undefined);

  assert.deepEqual(adapter.createPollRequest({
    remote: {
      queryableTaskId: 'poll-1',
      pollUrl: 'https://provider.example/tasks/poll-1/status',
    },
  }), {
    mode: 'remote_poll',
    url: '/api/v2/proxy/task?apiUrl=https%3A%2F%2Fprovider.example%2Ftasks%2Fpoll-1%2Fstatus',
  });
});

test('asyncTaskAdapters resolves GRSAI local proxy adapter contract', () => {
  const adapter = resolveAsyncTaskAdapter({
    kind: 'image',
    provider: 'grsai',
    recoveryMode: 'local_proxy_poll',
    runtimeTaskId: 'runtime-1',
    clientTaskId: 'client-1',
  });

  assert.equal(adapter.id, 'image:grsai:local_proxy_poll');
  assert.equal(adapter.kind, 'image');
  assert.equal(adapter.provider, 'grsai');
  assert.equal(adapter.recoveryMode, 'local_proxy_poll');
  assert.equal(adapter.canCancelRemote, false);
  assert.equal(adapter.canCancelLocal, false);
  assert.deepEqual(adapter.createPollRequest({
    local: { runtimeTaskId: 'runtime-1', clientTaskId: 'client-1' },
  }), {
    mode: 'local_proxy_poll',
    url: '/api/v2/proxy/local-task?runtimeTaskId=runtime-1&clientTaskId=client-1',
  });
});

test('asyncTaskAdapters normalizes poll response and result without side effects', () => {
  const adapter = resolveAsyncTaskAdapter({
    kind: 'image',
    provider: 'custom',
    recoveryMode: 'remote_poll',
  });

  const running = adapter.normalizePollResponse({ status: 'running', pending: true });
  assert.equal(running.status, 'running');
  assert.equal(running.pending, true);

  const success = adapter.normalizePollResponse({ status: 'succeeded', result: { imageUrl: '/output/a.png' } });
  assert.equal(success.status, 'success');
  assert.equal(success.pending, false);
  assert.deepEqual(adapter.normalizeResult(success.raw), { imageUrl: '/output/a.png' });
});

test('asyncTaskAdapters loading patch prefers original startedAt over refreshed createdAt', async () => {
  const module = await import('./asyncTaskAdapters.js');
  const patch = module.buildAsyncTaskLoadingPatch({
    kind: 'image',
    provider: 'grsai',
    runtimeTaskId: 'runtime-1',
    clientTaskId: 'client-1',
    createdAt: 42000,
    startedAt: 12000,
  });

  assert.equal(patch.generationStartTime, 12000);
  assert.equal(patch.asyncTaskStartedAt, 12000);
});

test('asyncTaskAdapters keeps local media cancellation local only', () => {
  const adapter = resolveAsyncTaskAdapter({
    kind: 'media',
    provider: 'local',
    recoveryMode: 'local_media',
    canCancel: true,
  });

  assert.equal(adapter.id, 'media:local:local_media');
  assert.equal(adapter.kind, 'media');
  assert.equal(adapter.canCancelRemote, false);
  assert.equal(adapter.canCancelLocal, true);
});

test('asyncTaskAdapters covers image recovery providers', () => {
  const cases = [
    { provider: 'grsai', recoveryMode: 'local_proxy_poll', expectedId: 'image:grsai:local_proxy_poll' },
    { provider: 'apimart', recoveryMode: 'remote_poll', expectedId: 'image:apimart:remote_poll' },
    { provider: 'custom', recoveryMode: 'remote_poll', expectedId: 'image:custom:remote_poll' },
    { provider: 'runninghub', recoveryMode: 'remote_poll', expectedId: 'image:runninghub:remote_poll' },
    { provider: 'dreamina', recoveryMode: 'remote_poll', expectedId: 'image:dreamina:remote_poll' },
  ];

  for (const item of cases) {
    const adapter = resolveAsyncTaskAdapter({
      kind: 'image',
      provider: item.provider,
      recoveryMode: item.recoveryMode,
      canCancel: true,
    });
    const pollRequest = adapter.createPollRequest(item.recoveryMode === 'local_proxy_poll'
      ? { local: { runtimeTaskId: 'runtime-1', clientTaskId: 'client-1' } }
      : { remote: { pollUrl: `https://provider.example/${item.provider}/poll-1` } });
    const success = adapter.normalizePollResponse({
      status: 'succeeded',
      result: { imageUrl: `/output/${item.provider}.png` },
    });

    assert.equal(adapter.id, item.expectedId);
    assert.equal(adapter.kind, 'image');
    assert.equal(adapter.provider, item.provider);
    assert.equal(adapter.recoveryMode, item.recoveryMode);
    assert.equal(adapter.canCancelRemote, false);
    assert.equal(adapter.canCancelLocal, false);
    assert.equal(pollRequest.mode, item.recoveryMode);
    assert.equal(success.status, 'success');
    assert.equal(success.pending, false);
    assert.deepEqual(adapter.normalizeResult(success.raw), { imageUrl: `/output/${item.provider}.png` });
  }
});

test('asyncTaskAdapters covers video recovery providers without fake remote cancel', () => {
  const cases = [
    { provider: 'runninghub', expectedId: 'video:runninghub:remote_poll' },
    { provider: 'dreamina', expectedId: 'video:dreamina:remote_poll' },
    { provider: 'custom', expectedId: 'video:custom:remote_poll' },
  ];

  for (const item of cases) {
    const adapter = resolveAsyncTaskAdapter({
      kind: 'video',
      provider: item.provider,
      recoveryMode: 'remote_poll',
      canCancel: true,
    });
    const success = adapter.normalizePollResponse({
      status: 'completed',
      result: { videoUrl: `/output/${item.provider}.mp4`, localPath: `output/${item.provider}.mp4` },
    });

    assert.equal(adapter.id, item.expectedId);
    assert.equal(adapter.kind, 'video');
    assert.equal(adapter.provider, item.provider);
    assert.equal(adapter.canCancelRemote, false);
    assert.equal(adapter.canCancelLocal, false);
    assert.equal(success.status, 'success');
    assert.deepEqual(adapter.normalizeResult(success.raw), {
      videoUrl: `/output/${item.provider}.mp4`,
      localPath: `output/${item.provider}.mp4`,
    });
  }
});

test('asyncTaskAdapters covers audio recovery providers and local media cancellation boundary', () => {
  const remoteCases = [
    { provider: 'runninghub', expectedId: 'audio:runninghub:remote_poll' },
    { provider: 'custom', expectedId: 'audio:custom:remote_poll' },
  ];

  for (const item of remoteCases) {
    const adapter = resolveAsyncTaskAdapter({
      kind: 'audio',
      provider: item.provider,
      recoveryMode: 'remote_poll',
      canCancel: true,
    });
    const success = adapter.normalizePollResponse({
      status: 'done',
      result: { audioUrl: `/output/${item.provider}.wav`, localPath: `output/${item.provider}.wav` },
    });

    assert.equal(adapter.id, item.expectedId);
    assert.equal(adapter.kind, 'audio');
    assert.equal(adapter.canCancelRemote, false);
    assert.equal(adapter.canCancelLocal, false);
    assert.equal(success.status, 'success');
    assert.deepEqual(adapter.normalizeResult(success.raw), {
      audioUrl: `/output/${item.provider}.wav`,
      localPath: `output/${item.provider}.wav`,
    });
  }

  const localMedia = resolveAsyncTaskAdapter({
    kind: 'media',
    provider: 'local',
    recoveryMode: 'local_media',
    canCancel: true,
  });
  assert.equal(localMedia.canCancelRemote, false);
  assert.equal(localMedia.canCancelLocal, true);
});