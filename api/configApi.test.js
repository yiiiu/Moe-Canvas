import test from 'node:test';
import assert from 'node:assert/strict';

function mockFetchOnceJson(payload) {
  globalThis.fetch = async url => {
    if (String(url) !== '/api/config') {
      throw new Error(`unexpected fetch url: ${String(url)}`);
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json',
      },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

function installSecureSettingsStub(
  testContext,
  { available = true, initialValues = {} } = {},
) {
  const previousWindow = globalThis.window;
  const values = { ...initialValues };
  const calls = [];

  globalThis.window = {
    electronAPI: {
      secureSettings: {
        async get(payload = {}) {
          calls.push({ method: 'get', payload });
          const keys = Array.isArray(payload.keys)
            ? payload.keys
            : [payload.key].filter(Boolean);
          return {
            ok: true,
            available,
            values: Object.fromEntries(
              keys
                .filter(key => Object.prototype.hasOwnProperty.call(values, key))
                .map(key => [key, values[key]]),
            ),
          };
        },
        async set(payload = {}) {
          calls.push({ method: 'set', payload });
          if (!available) {
            return { ok: false, available };
          }
          values[payload.key] = String(payload.value || '');
          return { ok: true, available };
        },
        async delete(payload = {}) {
          calls.push({ method: 'delete', payload });
          if (!available) {
            return { ok: false, available };
          }
          delete values[payload.key];
          return { ok: true, available };
        },
      },
    },
  };

  testContext.after(() => {
    globalThis.window = previousWindow;
  });

  return { values, calls };
}

function installFetchSequence(
  testContext,
  { getData = {}, postOk = true } = {},
) {
  const previousFetch = globalThis.fetch;
  const posts = [];

  globalThis.fetch = async (url, init = {}) => {
    if (String(url) !== '/api/config') {
      throw new Error(`unexpected fetch url: ${String(url)}`);
    }

    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'POST') {
      posts.push(JSON.parse(String(init.body || '{}')));
      return {
        ok: postOk,
        status: postOk ? 200 : 500,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: postOk }),
        text: async () => JSON.stringify({ success: postOk }),
      };
    }

    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => getData,
      text: async () => JSON.stringify(getData),
    };
  };

  testContext.after(() => {
    globalThis.fetch = previousFetch;
  });

  return { posts };
}

test('configApi: grsai provider 配置优先于 apiUrlInput/apiKeyInput', async () => {
  const previousFetch = globalThis.fetch;
  try {
    mockFetchOnceJson({
      apiUrlInput: 'https://api.grsai.example.com///',
      apiKeyInput: 'k_grsai',
      providers: {
        grsai: {
          apiUrl: 'https://grsai.example2.com/',
          apiKey: 'k_grsai2',
        },
      },
    });

    const { ensureConfig, getProviderConfig, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();
    await ensureConfig();

    const providerConfig = getProviderConfig('grsai');
    assert.equal(providerConfig.apiUrl, 'https://grsai.example2.com');
    assert.equal(providerConfig.apiKey, 'k_grsai2');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test(
  'configApi: Electron secureSettings 会迁移旧明文 API Key 并回写去敏配置',
  { concurrency: false },
  async testContext => {
    const { values } = installSecureSettingsStub(testContext);
    const { posts } = installFetchSequence(testContext, {
      getData: {
        apiUrlInput: 'https://api.grsai.example.com///',
        apiKeyInput: 'legacy-grsai-key',
        providers: {
          runninghub: {
            apiKey: 'rh-workflow-key',
            modelApiKey: 'rh-model-key',
          },
        },
      },
    });

    const { fetchApiConfigFromServer, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    const apiConfig = await fetchApiConfigFromServer();
    assert.equal(apiConfig.providers.grsai.apiKey, 'legacy-grsai-key');
    assert.equal(apiConfig.providers.runninghub.apiKey, 'rh-workflow-key');
    assert.equal(apiConfig.providers.runninghub.modelApiKey, 'rh-model-key');
    assert.equal(values['apiConfig.providers.grsai.apiKey'], 'legacy-grsai-key');
    assert.equal(values['apiConfig.providers.runninghub.apiKey'], 'rh-workflow-key');
    assert.equal(values['apiConfig.providers.runninghub.modelApiKey'], 'rh-model-key');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].apiKeyInput, undefined);
    assert.equal(posts[0].providers.runninghub.apiKey, undefined);
    assert.equal(posts[0].providers.runninghub.modelApiKey, undefined);
  },
);

test(
  'configApi: Electron secureSettings 保存时只把非敏感配置写入 config.json',
  { concurrency: false },
  async testContext => {
    const { values } = installSecureSettingsStub(testContext);
    const { posts } = installFetchSequence(testContext);
    const { saveApiConfigToServer, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    await saveApiConfigToServer({
      providers: {
        apimart: {
          apiKey: 'am-key',
          apiUrl: 'https://api.apimart.ai',
        },
        runninghub: {
          apiKey: 'rh-key',
          modelApiKey: 'rh-model-key',
        },
      },
    });

    assert.equal(values['apiConfig.providers.apimart.apiKey'], 'am-key');
    assert.equal(values['apiConfig.providers.runninghub.apiKey'], 'rh-key');
    assert.equal(values['apiConfig.providers.runninghub.modelApiKey'], 'rh-model-key');
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0], {
      providers: {
        apimart: {
          apiUrl: 'https://api.apimart.ai',
        },
        runninghub: {},
      },
      customProviders: [],
    });
  },
);

test(
  'configApi: secureSettings 不可用时保持明文配置兼容行为',
  { concurrency: false },
  async testContext => {
    installSecureSettingsStub(testContext, { available: false });
    const { posts } = installFetchSequence(testContext);
    const { saveApiConfigToServer, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    await saveApiConfigToServer({
      providers: {
        grsai: {
          apiKey: 'plain-key',
        },
      },
    });

    assert.deepEqual(posts, [
      {
        providers: {
          grsai: {
            apiKey: 'plain-key',
          },
        },
        customProviders: [],
      },
    ]);
  },
);

test('configApi: grsai 无 provider 配置时使用 apiUrlInput/apiKeyInput', async () => {
  const previousFetch = globalThis.fetch;
  try {
    mockFetchOnceJson({
      apiUrlInput: 'https://api.grsai.example.com',
      apiKeyInput: 'legacy-grsai-key',
      providers: {
        runninghub: {
          apiUrl: 'https://runninghub.example.com/',
          apiKey: 'k_rhwf',
          modelApiKey: 'k_rhmodel',
        },
      },
    });

    const { ensureConfig, getProviderConfig, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();
    await ensureConfig();

    const grsai = getProviderConfig('grsai');
    assert.equal(grsai.apiUrl, 'https://api.grsai.example.com');
    assert.equal(grsai.apiKey, 'legacy-grsai-key');

    const runninghub = getProviderConfig('runninghub');
    assert.equal(runninghub.apiKey, 'k_rhwf');
    assert.equal(runninghub.modelApiKey, 'k_rhmodel');

    const runninghubwf = getProviderConfig('runninghubwf');
    assert.equal(runninghubwf.apiKey, 'k_rhwf');
    assert.equal(runninghubwf.modelApiKey, '');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test(
  'configApi: customProviders 注册表会归一化并参与安全存储',
  { concurrency: false },
  async testContext => {
    const { values, calls } = installSecureSettingsStub(testContext);
    const { posts } = installFetchSequence(testContext, {
      getData: {
        customProviders: [
          {
            id: 'Acme Cloud',
            label: 'Acme',
            capabilities: ['text', 'image', 'unknown', 'text'],
            models: {
              text: ['gpt-4o-mini', 'gpt-4o-mini'],
              image: ['gpt-image-1'],
            },
          },
        ],
        providers: {
          'custom_acme-cloud': {
            apiUrl: 'https://api.acme.example.com///',
            apiKey: 'acme-key',
            modelApiKey: 'acme-model-key',
          },
        },
      },
    });

    const {
      fetchApiConfigFromServer,
      getCustomProvidersConfig,
      getCustomProviderMeta,
      getProviderConfig,
      clearApiConfig,
    } = await import('./configApi.js');
    clearApiConfig();

    const apiConfig = await fetchApiConfigFromServer();
    assert.deepEqual(apiConfig.customProviders, [
      {
        id: 'custom_acme-cloud',
        label: 'Acme',
        kind: 'openai-compatible',
        enabled: true,
        capabilities: ['text', 'image'],
        models: {
          text: ['gpt-4o-mini'],
          image: ['gpt-image-1'],
          video: [],
          audio: [],
        },
      },
    ]);
    assert.equal(values['apiConfig.providers.custom_acme-cloud.apiKey'], 'acme-key');
    assert.equal(
      values['apiConfig.providers.custom_acme-cloud.modelApiKey'],
      'acme-model-key',
    );
    assert.equal(posts.length, 1);
    assert.equal(posts[0].providers['custom_acme-cloud'].apiKey, undefined);
    assert.equal(posts[0].providers['custom_acme-cloud'].modelApiKey, undefined);
    assert.deepEqual(getCustomProvidersConfig(), apiConfig.customProviders);
    assert.deepEqual(getCustomProviderMeta('Acme Cloud'), apiConfig.customProviders[0]);
    assert.deepEqual(getProviderConfig('custom_acme-cloud'), {
      apiUrl: 'https://api.acme.example.com',
      apiKey: 'acme-key',
      modelApiKey: 'acme-model-key',
    });

    const secureReadCall = calls.find(
      entry => entry.method === 'get' && Array.isArray(entry.payload?.keys),
    );
    assert.equal(
      secureReadCall.payload.keys.includes('apiConfig.providers.custom_acme-cloud.apiKey'),
      true,
    );
    assert.equal(
      secureReadCall.payload.keys.includes(
        'apiConfig.providers.custom_acme-cloud.modelApiKey',
      ),
      true,
    );
  },
);

test(
  'configApi: 保存自定义供应商时保留注册表并剥离敏感字段',
  { concurrency: false },
  async testContext => {
    const { values } = installSecureSettingsStub(testContext);
    const { posts } = installFetchSequence(testContext);
    const { saveApiConfigToServer, clearApiConfig } = await import('./configApi.js');
    clearApiConfig();

    await saveApiConfigToServer({
      customProviders: [
        {
          id: 'custom_acme',
          label: 'Acme',
          capabilities: ['text', 'audio'],
          models: {
            text: ['gpt-4o-mini'],
            audio: ['tts-1'],
          },
        },
      ],
      providers: {
        custom_acme: {
          apiUrl: 'https://api.acme.example.com',
          apiKey: 'acme-key',
          modelApiKey: 'acme-model-key',
          enabled: true,
        },
      },
    });

    assert.equal(values['apiConfig.providers.custom_acme.apiKey'], 'acme-key');
    assert.equal(values['apiConfig.providers.custom_acme.modelApiKey'], 'acme-model-key');
    assert.deepEqual(posts[0], {
      customProviders: [
        {
          id: 'custom_acme',
          label: 'Acme',
          kind: 'openai-compatible',
          enabled: true,
          capabilities: ['text', 'audio'],
          models: {
            text: ['gpt-4o-mini'],
            image: [],
            video: [],
            audio: ['tts-1'],
          },
        },
      ],
      providers: {
        custom_acme: {
          apiUrl: 'https://api.acme.example.com',
          enabled: true,
        },
      },
    });
  },
);

test(
  'configApi: PPIO 内置配置会在读取和保存时移除',
  { concurrency: false },
  async testContext => {
    const { values } = installSecureSettingsStub(testContext, {
      initialValues: {
        'apiConfig.providers.ppio.apiKey': 'old-ppio-key',
        'apiConfig.providers.ppio.modelApiKey': 'old-ppio-model-key',
      },
    });
    const { posts } = installFetchSequence(testContext, {
      getData: {
        providers: {
          ppio: {
            apiUrl: 'https://api.ppio.example.com',
            apiKey: 'plain-ppio-key',
          },
          apimart: {
            apiUrl: 'https://api.apimart.ai',
          },
        },
      },
    });

    const {
      fetchApiConfigFromServer,
      getProviderConfig,
      saveApiConfigToServer,
      clearApiConfig,
    } = await import('./configApi.js');
    clearApiConfig();

    const apiConfig = await fetchApiConfigFromServer();
    assert.equal(Object.hasOwn(apiConfig.providers, 'ppio'), false);
    assert.equal(values['apiConfig.providers.ppio.apiKey'], undefined);
    assert.equal(values['apiConfig.providers.ppio.modelApiKey'], undefined);
    assert.deepEqual(getProviderConfig('ppio'), {
      apiUrl: '',
      apiKey: '',
      modelApiKey: '',
    });

    await saveApiConfigToServer({
      providers: {
        ppio: {
          apiUrl: 'https://api.ppio.example.com',
          apiKey: 'new-ppio-key',
        },
        apimart: {
          apiKey: 'am-key',
        },
      },
    });

    assert.equal(posts.at(-1).providers.ppio, undefined);
    assert.equal(values['apiConfig.providers.ppio.apiKey'], undefined);
    assert.equal(values['apiConfig.providers.apimart.apiKey'], 'am-key');
  },
);

test(
  'configApi: 旧 openai 兼容配置会合并为自定义供应商并保留原配置',
  { concurrency: false },
  async testContext => {
    installSecureSettingsStub(testContext, {
      initialValues: {
        'apiConfig.providers.openai.apiKey': 'legacy-openai-key',
      },
    });
    installFetchSequence(testContext, {
      getData: {
        providers: {
          openai: {
            apiUrl: 'https://api.legacy-openai.example.com/v1',
            enabled: true,
          },
        },
      },
    });

    const {
      fetchApiConfigFromServer,
      getCustomProviderMeta,
      getProviderConfig,
      clearApiConfig,
    } = await import('./configApi.js');
    clearApiConfig();

    const apiConfig = await fetchApiConfigFromServer();
    assert.equal(
      apiConfig.customProviders.some(
        provider => provider.id === 'custom_openai_compatible' && provider.label === 'OpenAI 兼容',
      ),
      true,
    );
    assert.deepEqual(getCustomProviderMeta('custom_openai_compatible'), {
      id: 'custom_openai_compatible',
      label: 'OpenAI 兼容',
      kind: 'openai-compatible',
      enabled: true,
      capabilities: ['text', 'connection_test'],
      models: {
        text: [],
        image: [],
        video: [],
        audio: [],
      },
    });
    assert.deepEqual(getProviderConfig('custom_openai_compatible'), {
      apiUrl: 'https://api.legacy-openai.example.com/v1',
      apiKey: 'legacy-openai-key',
      modelApiKey: '',
    });
    assert.deepEqual(getProviderConfig('openai'), {
      apiUrl: 'https://api.legacy-openai.example.com/v1',
      apiKey: 'legacy-openai-key',
      modelApiKey: '',
    });
  },
);