import test from 'node:test';
import assert from 'node:assert/strict';

import { clearApiConfig } from './configApi.js';
import { buildGenerateTextRequest } from './aiTextApi.js';
import { buildGenerateImageRequest } from './aiImageApi.js';
import { buildGenerateVideoRequest } from './aiVideoApi.js';
import { buildGenerateAudioRequest, generateAudio } from './aiAudioApi.js';

const CUSTOM_PROVIDER_ID = 'custom_acme';
const CUSTOM_API_URL = 'https://api.example.com';
const CUSTOM_API_KEY = 'k_custom';

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function buildCustomConfig() {
  return {
    providers: {
      [CUSTOM_PROVIDER_ID]: {
        apiUrl: CUSTOM_API_URL,
        apiKey: CUSTOM_API_KEY,
        enabled: true,
      },
    },
    customProviders: [
      {
        id: CUSTOM_PROVIDER_ID,
        label: 'Acme',
        kind: 'openai-compatible',
        enabled: true,
        capabilities: ['text', 'image', 'video', 'audio'],
        models: {
          text: ['gpt-5.5'],
          image: ['gpt-image-1'],
          video: ['veo-mini'],
          audio: ['tts-1'],
        },
      },
    ],
  };
}

async function withFetchMock(handler, run) {
  const originalFetch = globalThis.fetch;
  clearApiConfig();
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    clearApiConfig();
    globalThis.fetch = originalFetch;
  }
}

test('custom provider text route normalizes OpenAI-compatible base url variants', async () => {
  const baseUrlVariants = [
    CUSTOM_API_URL,
    `${CUSTOM_API_URL}/v1`,
    `${CUSTOM_API_URL}/v1/`,
    `${CUSTOM_API_URL}/v1/chat/completions`,
  ];

  for (const apiUrl of baseUrlVariants) {
    await withFetchMock(async (input, init = {}) => {
      const url = String(input);
      if (url === '/api/config') {
        return makeJsonResponse({
          ...buildCustomConfig(),
          providers: {
            [CUSTOM_PROVIDER_ID]: {
              apiUrl,
              apiKey: CUSTOM_API_KEY,
              enabled: true,
            },
          },
        });
      }
      throw new Error(`unexpected fetch url: ${url}`);
    }, async () => {
      const request = await buildGenerateTextRequest({
        provider: CUSTOM_PROVIDER_ID,
        model: 'gpt-5.5',
        prompt: '写一个短句',
      });

      assert.equal(request.url, '/api/v2/proxy/completions');
      assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/chat/completions`);
      assert.equal(request.body.apiKey, CUSTOM_API_KEY);
      assert.equal(request.body.model, 'gpt-5.5');
      assert.equal(request.isProxy, true);
      assert.equal(request.adapterTrace?.source, 'manifest');
      assert.equal(request.adapterTrace?.modelId, `${CUSTOM_PROVIDER_ID}/gpt-5.5`);
    });
  }
});

test('custom provider image route builds OpenAI-compatible manifest request', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse(buildCustomConfig());
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateImageRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'gpt-image-1',
      prompt: 'draw a neon cat',
      inputUrls: [],
    });

    assert.equal(request.url, '/api/v2/proxy/image');
    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/images/generations`);
    assert.equal(request.body.apiKey, CUSTOM_API_KEY);
    assert.equal(request.body.model, 'gpt-image-1');
    assert.equal(request.body.prompt, 'draw a neon cat');
    assert.equal(request.body.image, undefined);
    assert.equal(request.adapterTrace?.source, 'manifest');
    assert.equal(request.adapterTrace?.modelId, 'gpt-image-1');
  });
});

test('custom provider video route builds OpenAI-compatible manifest request', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse(buildCustomConfig());
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'veo-mini',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
      generationParams: {
        aspectRatio: '9:16',
        resolution: '1080p',
      },
    });

    assert.equal(request.url, '/api/v2/proxy/image');
    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/videos/generations`);
    assert.equal(request.body.apiKey, CUSTOM_API_KEY);
    assert.equal(request.body.model, 'veo-mini');
    assert.equal(request.body.prompt, 'animate a skyline at dusk');
    assert.deepEqual(request.body.messages, [
      { role: 'user', content: 'animate a skyline at dusk' },
    ]);
    assert.equal(request.body.image, undefined);
    assert.equal(request.body.video, undefined);
    assert.equal(request.body.audio, undefined);
    assert.equal(request.body.aspect_ratio, '9:16');
    assert.equal(request.body.resolution, '1080p');
    assert.equal(request.adapterTrace?.source, 'manifest');
    assert.equal(request.adapterTrace?.modelId, 'veo-mini');
  });
});

test('custom provider video route auto-selects chat-compatible endpoint by model name', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        ...buildCustomConfig(),
        customProviders: [
          {
            ...buildCustomConfig().customProviders[0],
            models: {
              ...buildCustomConfig().customProviders[0].models,
              video: ['gpt-video-1'],
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'gpt-video-1',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
    });

    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/chat/completions`);
    assert.equal(request.body.model, 'gpt-video-1');
    assert.deepEqual(request.body.messages, [
      { role: 'user', content: 'animate a skyline at dusk' },
    ]);
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('custom provider video route uses configured relative endpoint', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        ...buildCustomConfig(),
        customProviders: [
          {
            ...buildCustomConfig().customProviders[0],
            endpoints: {
              video: '/v1/video/generations',
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'veo-mini',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
    });

    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/video/generations`);
    assert.equal(request.body.model, 'veo-mini');
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('custom provider video route uses endpoint preset', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        ...buildCustomConfig(),
        customProviders: [
          {
            ...buildCustomConfig().customProviders[0],
            endpointPresets: {
              video: 'openai_chat',
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'veo-mini',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
    });

    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/chat/completions`);
    assert.equal(request.body.model, 'veo-mini');
    assert.deepEqual(request.body.messages, [
      { role: 'user', content: 'animate a skyline at dusk' },
    ]);
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('custom provider video route uses configured absolute endpoint directly', async () => {
  const absoluteEndpoint = 'https://video.example.com/openai/v1/generations';

  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        ...buildCustomConfig(),
        customProviders: [
          {
            ...buildCustomConfig().customProviders[0],
            endpoints: {
              video: absoluteEndpoint,
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'veo-mini',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
    });

    assert.equal(request.body.apiUrl, absoluteEndpoint);
    assert.equal(request.body.model, 'veo-mini');
    assert.equal(request.adapterTrace?.source, 'manifest');
  });
});

test('custom provider video route rejects relative endpoint when base url is missing', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse({
        ...buildCustomConfig(),
        providers: {
          [CUSTOM_PROVIDER_ID]: {
            apiUrl: '',
            apiKey: CUSTOM_API_KEY,
            enabled: true,
          },
        },
        customProviders: [
          {
            ...buildCustomConfig().customProviders[0],
            endpoints: {
              video: '/v1/video/generations',
            },
          },
        ],
      });
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    await assert.rejects(
      () => buildGenerateVideoRequest({
        provider: CUSTOM_PROVIDER_ID,
        model: 'veo-mini',
        prompt: 'animate a skyline at dusk',
        inputUrls: [],
        videos: [],
        audios: [],
      }),
      /自定义供应商未配置接口地址/,
    );
  });
});

test('custom provider video route includes default aspect ratio and resolution params', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse(buildCustomConfig());
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateVideoRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'veo-mini',
      prompt: 'animate a skyline at dusk',
      inputUrls: [],
      videos: [],
      audios: [],
    });

    assert.equal(request.body.aspect_ratio, '16:9');
    assert.equal(request.body.resolution, '720p');
    assert.equal(request.adapterTrace?.source, 'manifest');
    assert.equal(request.adapterTrace?.modelId, 'veo-mini');
  });
});

test('custom provider audio route builds OpenAI-compatible manifest request', async () => {
  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    if (url === '/api/config') {
      return makeJsonResponse(buildCustomConfig());
    }
    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const request = await buildGenerateAudioRequest({
      provider: CUSTOM_PROVIDER_ID,
      model: 'tts-1',
      prompt: '请把这句话读出来',
      voice: 'alloy',
      responseFormat: 'mp3',
    });

    assert.equal(request.url, '/api/v2/proxy/image');
    assert.equal(request.body.apiUrl, `${CUSTOM_API_URL}/v1/audio/speech`);
    assert.equal(request.body.apiKey, CUSTOM_API_KEY);
    assert.equal(request.body.model, 'tts-1');
    assert.equal(request.body.input, '请把这句话读出来');
    assert.equal(request.body.voice, 'alloy');
    assert.equal(request.body.response_format, 'mp3');
    assert.equal(request.meta?.customAudioManifest, true);
    assert.equal(request.meta?.audioRoute, 'manifest');
    assert.equal(request.meta?.adapterTrace?.source, 'manifest');
  });
});

test('custom provider audio generation normalizes remote url results', async () => {
  const seenRequests = [];

  await withFetchMock(async (input, init = {}) => {
    const url = String(input);
    seenRequests.push({
      url,
      method: init?.method || 'GET',
      headers: init?.headers,
      body: init?.body,
    });

    if (url === '/api/config') {
      return makeJsonResponse(buildCustomConfig());
    }

    if (url === `${CUSTOM_API_URL}/v1/audio/speech`) {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers?.Authorization, `Bearer ${CUSTOM_API_KEY}`);
      assert.equal(init?.headers?.['Content-Type'], 'application/json');

      const payload = JSON.parse(String(init?.body || '{}'));
      assert.equal(payload.model, 'tts-1');
      assert.equal(payload.input, '播放自定义供应商音频');
      assert.equal(payload.voice, 'alloy');
      assert.equal(payload.response_format, 'mp3');

      return new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example.com/custom-audio.mp3' }],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (url === '/api/v2/save_output_from_url') {
      assert.equal(init?.method, 'POST');
      const payload = JSON.parse(String(init?.body || '{}'));
      assert.equal(payload.url, 'https://cdn.example.com/custom-audio.mp3');
      assert.equal(payload.ext, 'mp3');
      return makeJsonResponse({ path: 'output/custom-audio.mp3' });
    }

    throw new Error(`unexpected fetch url: ${url}`);
  }, async () => {
    const result = await generateAudio({
      provider: CUSTOM_PROVIDER_ID,
      model: 'tts-1',
      prompt: '播放自定义供应商音频',
      voice: 'alloy',
      responseFormat: 'mp3',
    });

    assert.equal(result.audioUrl, '/output/custom-audio.mp3');
    assert.equal(result.localPath, 'output/custom-audio.mp3');
    assert.equal(result.isBatch, false);
    assert.deepEqual(result.audios, [
      {
        localPath: 'output/custom-audio.mp3',
        sourceUrl: 'https://cdn.example.com/custom-audio.mp3',
        audioUrl: '/output/custom-audio.mp3',
      },
    ]);
    assert.equal(result.adapterTrace?.source, 'manifest');

    assert.ok(seenRequests.some(entry => entry.url === `${CUSTOM_API_URL}/v1/audio/speech`));
    assert.ok(seenRequests.some(entry => entry.url === '/api/v2/save_output_from_url'));
  });
});