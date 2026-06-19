import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiConfig } from './configApi.js';
import { buildGenerateVideoRequest } from './aiVideoApi.js';
import { getProviderMeta } from '../src/modules/providers.js';
import { resolveModelExecution } from '../src/manifests/index.js';

const HELLOBABYGO_API_URL = 'https://api.hellobabygo.com';
const HELLOBABYGO_API_KEY = 'hbg-key';

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function withConfigMock(run) {
  const originalFetch = globalThis.fetch;
  clearApiConfig();
  const uploadedImageNames = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        providers: {
          hellobabygo: {
            apiKey: HELLOBABYGO_API_KEY,
            enabled: true,
          },
        },
      });
    }
    const exampleImageMatch = url.match(/^https:\/\/example\.com\/(first|last|ref-[1-7])\.jpg$/);
    if (exampleImageMatch) {
      uploadedImageNames.push(exampleImageMatch[1]);
      return new Response(new Blob(['fake image'], { type: 'image/jpeg' }), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (url === 'https://telegra.ph/upload' && String(init?.method || '').toUpperCase() === 'POST') {
      return makeJsonResponse([{ src: `/${uploadedImageNames.shift() || 'first'}.jpg` }]);
    }
    throw new Error(`unexpected fetch url: ${url}`);
  };

  try {
    return await run();
  } finally {
    clearApiConfig();
    globalThis.fetch = originalFetch;
  }
}

test('hellobabygo is registered as a built-in provider', () => {
  const provider = getProviderMeta('hellobabygo');

  assert.equal(provider?.id, 'hellobabygo');
  assert.equal(provider?.label, '斑点蛙');
  assert.equal(provider?.defaultUrl, HELLOBABYGO_API_URL);
});

test('hellobabygo grok video manifest posts to documented videos endpoint', async () => {
  await withConfigMock(async () => {
    const execution = resolveModelExecution('hellobabygo/grok-imagine-video-1.5-preview', {
      providerHint: 'hellobabygo',
    });

    assert.equal(execution?.modelManifest?.provider, 'hellobabygo');
    assert.equal(execution?.executionManifest?.adapterType, 'modelApi');

    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/grok-imagine-video-1.5-preview',
      prompt: '一只小猫在雨后街道奔跑',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '9:16',
        seconds: 10,
      },
      runtimeTaskId: 'runtime-hbg-video-1',
      clientTaskId: 'client-hbg-video-1',
      nodeId: 'node-hbg-video-1',
      canvasId: 'canvas-hbg-video-1',
    });

    assert.equal(request.url, '/api/v2/proxy/video');
    assert.equal(request.body.apiUrl, `${HELLOBABYGO_API_URL}/v1/videos`);
    assert.equal(request.body.apiKey, HELLOBABYGO_API_KEY);
    assert.equal(request.body.model, 'grok-imagine-video-1.5-preview');
    assert.equal(request.body.prompt, '一只小猫在雨后街道奔跑');
    assert.equal(request.body.size, '720x1280');
    assert.equal(request.body.seconds, '10');
    assert.equal(request.body.input_reference, undefined);
    assert.equal(request.body.runtimeTaskId, 'runtime-hbg-video-1');
    assert.equal(request.body.clientTaskId, 'client-hbg-video-1');
    assert.equal(request.body.nodeId, 'node-hbg-video-1');
    assert.equal(request.body.canvasId, 'canvas-hbg-video-1');
    assert.equal(request.body.provider, 'hellobabygo');
    assert.equal(request.body.kind, 'video');
    assert.equal(request.taskPolling?.urlTemplate, `${HELLOBABYGO_API_URL}/v1/videos/{taskId}`);
    assert.equal(request.taskPolling?.method, 'GET');
    assert.equal(request.taskPolling?.headersMode, 'bearer');
    assert.equal(request.taskPolling?.provider, 'hellobabygo');
    assert.deepEqual(request.responseMapping, {
      taskIdPaths: ['task_id', 'id', 'data.task_id', 'data.id'],
      resultPaths: [
        'videoUrl',
        'video_url',
        'url',
        'data.videoUrl',
        'data.video_url',
        'data.url',
        'results[].url',
        'results[].videoUrl',
      ],
    });
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('hellobabygo veo video manifest keeps the selected provider model token', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '电影感山谷航拍镜头',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '16:9',
        seconds: 8,
      },
      runtimeTaskId: 'runtime-hbg-veo-video-1',
      clientTaskId: 'client-hbg-veo-video-1',
      nodeId: 'node-hbg-veo-video-1',
      canvasId: 'canvas-hbg-veo-video-1',
    });

    assert.equal(request.url, '/api/v2/proxy/video');
    assert.equal(request.body.apiUrl, `${HELLOBABYGO_API_URL}/v1/videos`);
    assert.equal(request.body.model, 'veo_3_1-fast-landscape');
    assert.notEqual(request.body.model, 'grok-imagine-video-1.5-preview');
    assert.equal(request.body.prompt, '电影感山谷航拍镜头');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
    assert.equal(request.body.provider, 'hellobabygo');
    assert.equal(request.body.kind, 'video');
    assert.equal(request.taskPolling?.urlTemplate, `${HELLOBABYGO_API_URL}/v1/videos/{taskId}`);
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('hellobabygo auto ratio plus 720p resolution maps to a valid videos request body', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '电影感山谷航拍镜头',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: 'auto',
        resolution: '720p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-video-default',
      clientTaskId: 'client-hbg-veo-video-default',
      nodeId: 'node-hbg-veo-video-default',
      canvasId: 'canvas-hbg-veo-video-default',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
    assert.equal(request.body.resolution, undefined);
  });
});

test('hellobabygo VEO fast defaults to 720p and 8 seconds when params are omitted', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '默认参数运镜',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {},
      runtimeTaskId: 'runtime-hbg-veo-defaults',
      clientTaskId: 'client-hbg-veo-defaults',
      nodeId: 'node-hbg-veo-defaults',
      canvasId: 'canvas-hbg-veo-defaults',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
  });
});

test('hellobabygo VEO fixes provider duration to 8 even when duration is supplied', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: 'duration 字段运镜',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '16:9',
        resolution: '720p',
        duration: '10',
      },
      runtimeTaskId: 'runtime-hbg-veo-duration',
      clientTaskId: 'client-hbg-veo-duration',
      nodeId: 'node-hbg-veo-duration',
      canvasId: 'canvas-hbg-veo-duration',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
  });
});

test('hellobabygo non-VEO models do not map duration to provider seconds', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/grok-imagine-video-1.5-preview',
      prompt: 'grok duration 不应覆盖秒数',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '16:9',
        duration: '6',
      },
      runtimeTaskId: 'runtime-hbg-grok-duration',
      clientTaskId: 'client-hbg-grok-duration',
      nodeId: 'node-hbg-grok-duration',
      canvasId: 'canvas-hbg-grok-duration',
    });

    assert.equal(request.body.model, 'grok-imagine-video-1.5-preview');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.seconds, '10');
    assert.equal(request.body.duration, undefined);
  });
});

test('hellobabygo auto ratio plus 1080p resolution maps to 1080p videos request body', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '电影感山谷航拍镜头',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: 'auto',
        resolution: '1080p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-video-1080p',
      clientTaskId: 'client-hbg-veo-video-1080p',
      nodeId: 'node-hbg-veo-video-1080p',
      canvasId: 'canvas-hbg-veo-video-1080p',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape');
    assert.equal(request.body.size, '1920x1080');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
    assert.equal(request.body.resolution, undefined);
  });
});

test('hellobabygo VEO model token follows the selected portrait ratio', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '竖屏人物运镜',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '9:16',
        resolution: '720p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-ratio-portrait',
      clientTaskId: 'client-hbg-veo-ratio-portrait',
      nodeId: 'node-hbg-veo-ratio-portrait',
      canvasId: 'canvas-hbg-veo-ratio-portrait',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-portrait');
    assert.equal(request.body.size, '720x1280');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
  });
});

test('hellobabygo VEO text mode can explicitly select HD model tier', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '高清横屏运镜',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        generation_type: 'text_hd',
        aspectRatio: '16:9',
        resolution: '720p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-hd-landscape',
      clientTaskId: 'client-hbg-veo-hd-landscape',
      nodeId: 'node-hbg-veo-hd-landscape',
      canvasId: 'canvas-hbg-veo-hd-landscape',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape-hd');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
  });
});

test('hellobabygo VEO image input switches to first-last-frame HD model', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '从首帧自然运动',
      inputUrls: ['https://example.com/first.jpg', 'https://example.com/last.jpg'],
      videos: [],
      audios: [],
      generationParams: {
        generation_type: 'frame',
        aspectRatio: '16:9',
        resolution: '720p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-first-frame',
      clientTaskId: 'client-hbg-veo-first-frame',
      nodeId: 'node-hbg-veo-first-frame',
      canvasId: 'canvas-hbg-veo-first-frame',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape-fl-hd');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
    assert.equal(request.body.input_reference, undefined);
    assert.deepEqual(request.body.reference_images, ['https://telegra.ph/first.jpg', 'https://telegra.ph/last.jpg']);
    assert.equal(request.body.reference_mode, 'image');
  });
});

test('hellobabygo VEO reference mode keeps reference images out of first-last-frame routing', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/veo_3_1-fast-landscape',
      prompt: '参考角色和场景风格生成视频',
      inputUrls: ['https://example.com/ref-1.jpg', 'https://example.com/ref-2.jpg'],
      videos: [],
      audios: [],
      generationParams: {
        generation_type: 'reference',
        aspectRatio: '16:9',
        resolution: '720p',
        seconds: '8',
      },
      runtimeTaskId: 'runtime-hbg-veo-reference',
      clientTaskId: 'client-hbg-veo-reference',
      nodeId: 'node-hbg-veo-reference',
      canvasId: 'canvas-hbg-veo-reference',
    });

    assert.equal(request.body.model, 'veo_3_1-fast-landscape-hd');
    assert.equal(request.body.size, '1280x720');
    assert.equal(request.body.duration, 8);
    assert.equal(request.body.seconds, undefined);
    assert.equal(request.body.input_reference, 'https://telegra.ph/ref-1.jpg');
    assert.equal(Array.isArray(request.body.input_reference), false);
  });
});

test('hellobabygo Omni Flash sends JSON reference images and no VEO mode fields', async () => {
  await withConfigMock(async () => {
    const request = await buildGenerateVideoRequest({
      provider: 'hellobabygo',
      model: 'hellobabygo/omni_flash',
      prompt: '参考多张图生成一致风格的视频',
      inputUrls: [
        'https://example.com/ref-1.jpg',
        'https://example.com/ref-2.jpg',
        'https://example.com/ref-3.jpg',
        'https://example.com/ref-4.jpg',
        'https://example.com/ref-5.jpg',
        'https://example.com/ref-6.jpg',
        'https://example.com/ref-7.jpg',
      ],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '9:16',
        resolution: '1080p',
      },
      runtimeTaskId: 'runtime-hbg-omni-reference',
      clientTaskId: 'client-hbg-omni-reference',
      nodeId: 'node-hbg-omni-reference',
      canvasId: 'canvas-hbg-omni-reference',
    });

    assert.equal(request.url, '/api/v2/proxy/video');
    assert.equal(request.body.apiUrl, `${HELLOBABYGO_API_URL}/v1/videos`);
    assert.equal(request.body.model, 'omni_flash');
    assert.equal(request.body.size, '1080x1920');
    assert.equal(request.body.seconds, '10');
    assert.equal(request.body.duration, undefined);
    assert.equal(request.body.input_reference, undefined);
    assert.deepEqual(request.body.reference_images, [
      'https://telegra.ph/ref-1.jpg',
      'https://telegra.ph/ref-2.jpg',
      'https://telegra.ph/ref-3.jpg',
      'https://telegra.ph/ref-4.jpg',
      'https://telegra.ph/ref-5.jpg',
      'https://telegra.ph/ref-6.jpg',
      'https://telegra.ph/ref-7.jpg',
    ]);
    assert.equal(request.body.reference_mode, 'image');
    assert.equal(request.body.generation_type, undefined);
  });
});