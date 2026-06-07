import { request } from '../../../api/apiBase.js';
import { markSettingsUnsavedChanges } from './settingsUnsavedChanges.js';
import {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_DEFAULT_VIDEO_ENDPOINT_PRESET,
  CUSTOM_PROVIDER_MODEL_CAPABILITIES,
  getCustomProviders,
  isCustomProviderId,
  normalizeCustomProviderId,
} from '../../../api/customProviderRegistry.js';

const HOST_ID = 'customProvidersHost';
const LIST_ID = 'customProvidersList';
const ADD_BUTTON_ID = 'btnAddCustomProvider';
const ENABLED_CAPABILITY = 'connection_test';
const DEFAULT_CAPABILITIES = ['text', 'connection_test'];
const CAPABILITY_LABELS = Object.freeze({
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  connection_test: '连接测试',
});
const MODEL_LABELS = Object.freeze({
  text: '文本模型',
  image: '图片模型',
  video: '视频模型',
  audio: '音频模型',
});

let bindingState = {
  bound: false,
  onProviderTest: null,
  onProviderEdited: null,
};

let activeModelEditor = null;
let activeFetchedModelsPicker = null;
let expandedCustomProviderIds = new Set();

function normalizeString(value) {
  return String(value || '').trim();
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getHost() {
  return document.getElementById(HOST_ID);
}

function getList() {
  return document.getElementById(LIST_ID);
}

function getAddButton() {
  return document.getElementById(ADD_BUTTON_ID);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseModelLines(value) {
  return unique(
    String(value || '')
      .split(/\r?\n|,/)
      .map(item => normalizeString(item)),
  );
}

function formatModelLines(models) {
  return Array.isArray(models) ? models.join('\n') : '';
}

function normalizeBaseUrl(apiUrl) {
  return normalizeString(apiUrl).replace(/\/+$/g, '');
}

function trimSlashes(value) {
  return normalizeString(value).replace(/^\/+|\/+$/g, '');
}

function joinUrl(baseUrl, path) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = trimSlashes(path);
  if (!normalizedBaseUrl) {
    return normalizedPath;
  }
  if (!normalizedPath) {
    return normalizedBaseUrl;
  }
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

function stripKnownOpenAiTail(apiUrl) {
  return normalizeBaseUrl(apiUrl)
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/completions$/i, '')
    .replace(/\/models$/i, '');
}

function buildModelsFetchUrl(apiUrl) {
  const strippedBaseUrl = stripKnownOpenAiTail(apiUrl);
  if (!strippedBaseUrl || strippedBaseUrl.includes(':generateContent')) {
    return '';
  }
  if (/\/v\d+(?:beta)?$/i.test(strippedBaseUrl) || /\/openai\/v1$/i.test(strippedBaseUrl)) {
    return joinUrl(strippedBaseUrl, 'models');
  }
  return joinUrl(strippedBaseUrl, 'v1/models');
}

function extractModelIds(payload) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  return unique(
    source
      .map(item => (typeof item === 'string' ? item : item?.id || item?.name || item?.model))
      .map(model => normalizeString(model)),
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildCardTitle(provider) {
  return normalizeString(provider.label) || '自定义供应商';
}

function buildNewProviderId() {
  return normalizeCustomProviderId(`provider-${Date.now().toString(36)}`);
}

function createEmptyProvider(providerId = '') {
  const id = normalizeCustomProviderId(providerId || buildNewProviderId());
  return {
    id,
    label: '',
    note: '',
    kind: 'openai-compatible',
    enabled: true,
    capabilities: [...DEFAULT_CAPABILITIES],
    models: {
      text: [],
      image: [],
      video: [],
      audio: [],
    },
    endpoints: {
      video: '',
    },
    endpointPresets: {
      video: CUSTOM_PROVIDER_DEFAULT_VIDEO_ENDPOINT_PRESET,
    },
    config: {
      apiUrl: '',
      apiKey: '',
      modelApiKey: '',
      enabled: true,
    },
  };
}

function normalizeProviderForView(entry = {}, providerConfigs = {}) {
  const providerId = normalizeCustomProviderId(entry.id || entry.label || buildNewProviderId());
  const providerConfig = isPlainObject(providerConfigs[providerId]) ? providerConfigs[providerId] : {};
  const capabilities = Array.isArray(entry.capabilities)
    ? entry.capabilities.map(value => normalizeString(value).toLowerCase()).filter(Boolean)
    : [];

  return {
    id: providerId,
    label: normalizeString(entry.label),
    note: normalizeString(entry.note),
    kind: normalizeString(entry.kind || 'openai-compatible') || 'openai-compatible',
    enabled: entry.enabled !== false,
    capabilities: capabilities.length > 0 ? unique(capabilities) : [...DEFAULT_CAPABILITIES],
    models: CUSTOM_PROVIDER_MODEL_CAPABILITIES.reduce((accumulator, capability) => {
      accumulator[capability] = Array.isArray(entry?.models?.[capability])
        ? unique(entry.models[capability].map(model => normalizeString(model)))
        : [];
      return accumulator;
    }, {}),
    endpoints: {
      video: normalizeString(entry?.endpoints?.video),
    },
    endpointPresets: {
      video: normalizeString(entry?.endpointPresets?.video) || CUSTOM_PROVIDER_DEFAULT_VIDEO_ENDPOINT_PRESET,
    },
    config: {
      apiUrl: normalizeString(providerConfig.apiUrl),
      apiKey: normalizeString(providerConfig.apiKey),
      modelApiKey: normalizeString(providerConfig.modelApiKey),
      enabled: providerConfig.enabled !== false,
    },
  };
}

function normalizeProvidersForView(config = {}) {
  const providerConfigs = isPlainObject(config.providers) ? config.providers : {};
  const registry = getCustomProviders(config);
  return registry.map(entry => normalizeProviderForView(entry, providerConfigs));
}

function readProvidersFromDom() {
  const list = getList();
  if (!list) {
    return [];
  }

  return [...list.querySelectorAll('[data-custom-provider-card]')].map(card => {
    const providerId = normalizeCustomProviderId(card.dataset.customProviderCard || buildNewProviderId());
    const label = normalizeString(card.querySelector('[data-custom-provider-field="label"]')?.value);
    const note = normalizeString(card.querySelector('[data-custom-provider-field="note"]')?.value);
    const apiUrl = normalizeString(card.querySelector('[data-custom-provider-field="apiUrl"]')?.value);
    const apiKey = normalizeString(card.querySelector('[data-custom-provider-field="apiKey"]')?.value);
    const videoEndpointPreset = normalizeString(card.querySelector('[data-custom-provider-field="videoEndpointPreset"]')?.value)
      || CUSTOM_PROVIDER_DEFAULT_VIDEO_ENDPOINT_PRESET;
    const videoEndpoint = normalizeString(card.querySelector('[data-custom-provider-field="videoEndpoint"]')?.value);
    const enabled = card.querySelector('[data-custom-provider-field="enabled"]')?.checked !== false;
    const capabilities = unique(
      [...card.querySelectorAll('[data-custom-provider-capability]:checked')].map(input =>
        normalizeString(input.value).toLowerCase(),
      ),
    );
    const models = CUSTOM_PROVIDER_MODEL_CAPABILITIES.reduce((accumulator, capability) => {
      accumulator[capability] = parseModelLines(
        card.querySelector(`[data-custom-provider-model="${capability}"]`)?.value,
      );
      return accumulator;
    }, {});

    return {
      id: providerId,
      label,
      note,
      kind: 'openai-compatible',
      enabled,
      capabilities: capabilities.length > 0 ? capabilities : [...DEFAULT_CAPABILITIES],
      models,
      endpoints: {
        ...(videoEndpoint ? { video: videoEndpoint } : {}),
      },
      endpointPresets: {
        video: videoEndpointPreset,
      },
      config: {
        apiUrl,
        apiKey,
        modelApiKey: normalizeString(card.dataset.modelApiKey || ''),
        enabled,
      },
    };
  });
}

function renderCapabilityOption(providerId, capabilities, capability) {
  const checked = capabilities.includes(capability);
  const activeClass = checked ? ' is-active' : '';
  const pressed = checked ? 'true' : 'false';
  const inputChecked = checked ? 'checked' : '';
  return `
    <button
      type="button"
      class="settings-chip-btn settings-capability-btn${activeClass}"
      data-custom-provider-capability-toggle="${escapeHtml(capability)}"
      data-custom-provider-id="${escapeHtml(providerId)}"
      aria-pressed="${pressed}"
    >
      ${escapeHtml(CAPABILITY_LABELS[capability] || capability)}
    </button>
    <input
      type="checkbox"
      class="settings-hidden-control"
      data-custom-provider-capability
      data-custom-provider-id="${escapeHtml(providerId)}"
      value="${escapeHtml(capability)}"
      ${inputChecked}
    />
  `;
}

function renderModelTags(models, capability) {
  const items = Array.isArray(models?.[capability]) ? models[capability].filter(Boolean) : [];
  if (items.length === 0) {
    return '<span class="settings-model-tag-empty">未配置</span>';
  }
  return `
    <span class="settings-model-tag-list">
      ${items.map(model => `
        <span class="settings-model-tag" title="${escapeHtml(model)}">
          <span class="settings-model-tag-text">${escapeHtml(model)}</span>
          <button
            type="button"
            class="settings-model-tag-remove"
            data-custom-provider-model-remove="${escapeHtml(capability)}"
            data-custom-provider-model-value="${escapeHtml(model)}"
            aria-label="移除模型 ${escapeHtml(model)}"
          >×</button>
        </span>
      `).join('')}
    </span>
  `;
}

function renderModelButton(providerId, models, capability) {
  return `
    <div class="settings-model-action">
      <div class="settings-model-action-head">
        <span class="settings-model-edit-label">${escapeHtml(MODEL_LABELS[capability] || capability)}</span>
        <button
          type="button"
          class="settings-chip-btn settings-model-edit-btn"
          data-custom-provider-model-open="${escapeHtml(capability)}"
          data-custom-provider-id="${escapeHtml(providerId)}"
        >编辑</button>
      </div>
      <div class="settings-model-edit-summary" data-custom-provider-model-summary="${escapeHtml(capability)}">
        ${renderModelTags(models, capability)}
      </div>
      <textarea
        class="settings-hidden-control"
        data-custom-provider-model="${escapeHtml(capability)}"
        data-custom-provider-id="${escapeHtml(providerId)}"
      >${escapeHtml(formatModelLines(models[capability]))}</textarea>
    </div>
  `;
}

function renderProviderCard(provider) {
  const capabilities = unique(provider.capabilities);
  const isEnabled = provider.enabled !== false;
  const enabledChecked = isEnabled ? 'checked' : '';
  const enabledActiveClass = isEnabled ? ' is-active' : '';
  const enabledPressed = isEnabled ? 'true' : 'false';
  const enabledLabel = isEnabled ? '已启用' : '已停用';
  const testDisabled = capabilities.includes(ENABLED_CAPABILITY) ? '' : 'disabled';
  const testTitle = capabilities.includes(ENABLED_CAPABILITY)
    ? `测试 ${buildCardTitle(provider)} 连接`
    : `未启用连接测试能力`;
  const isExpanded = expandedCustomProviderIds.has(provider.id);
  const collapsedClass = isExpanded ? '' : ' is-collapsed';
  const collapseLabel = isExpanded ? '收起' : '展开';
  const collapsePressed = isExpanded ? 'true' : 'false';

  return `
    <div
      class="settings-section settings-card settings-custom-provider-card${collapsedClass}"
      data-custom-provider-card="${escapeHtml(provider.id)}"
      data-model-api-key="${escapeHtml(provider.config.modelApiKey || '')}"
    >
      <div class="settings-card-head settings-custom-provider-head">
        <div class="settings-card-badge">CP</div>
        <div class="settings-custom-provider-title-wrap">
          <span class="settings-card-title">${escapeHtml(buildCardTitle(provider))}</span>
          <span class="settings-custom-provider-subtitle">${escapeHtml(provider.config.apiUrl || provider.id)}</span>
        </div>
        <span
          class="settings-provider-status settings-provider-status--test"
          id="providerTestStatus-${escapeHtml(provider.id)}"
          hidden
        ></span>
        <span
          class="settings-provider-balance"
          id="providerBalance-${escapeHtml(provider.id)}"
          hidden
        ></span>
        <button
          type="button"
          class="settings-custom-provider-collapse-btn"
          data-custom-provider-collapse="${escapeHtml(provider.id)}"
          aria-expanded="${collapsePressed}"
          aria-label="${escapeHtml(collapseLabel)}自定义供应商"
          title="${escapeHtml(collapseLabel)}自定义供应商"
        >
          <svg
            class="settings-custom-provider-collapse-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span class="settings-btn-label settings-custom-provider-collapse-label">${escapeHtml(collapseLabel)}</span>
        </button>
        <button
          type="button"
          class="settings-provider-fetch-models-btn"
          data-custom-provider-fetch-models="${escapeHtml(provider.id)}"
          data-custom-provider-id="${escapeHtml(provider.id)}"
          title="获取模型"
          aria-label="获取模型"
        >
          获取模型
        </button>
        <button
          type="button"
          class="settings-provider-test-btn settings-provider-test-btn--icon"
          data-provider-test="${escapeHtml(provider.id)}"
          title="${escapeHtml(testTitle)}"
          aria-label="${escapeHtml(testTitle)}"
          ${testDisabled}
        >
          <svg
            class="settings-btn-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span class="settings-btn-label">测试连接</span>
        </button>
        <button
          type="button"
          class="settings-getkey settings-custom-provider-remove-btn"
          data-custom-provider-remove="${escapeHtml(provider.id)}"
          title="删除自定义供应商"
        >
          删除
        </button>
      </div>
      <div class="settings-custom-provider-body">
        <div class="settings-custom-provider-grid">
        <div>
          <div class="settings-label">供应商名称</div>
          <input
            type="text"
            class="settings-input settings-input--mb10"
            data-custom-provider-field="label"
            data-custom-provider-id="${escapeHtml(provider.id)}"
            value="${escapeHtml(provider.label)}"
            placeholder="例如 Acme"
          />
        </div>
        <div>
          <div class="settings-label">供应商 ID</div>
          <input
            type="text"
            class="settings-input settings-input--mb10"
            value="${escapeHtml(provider.id)}"
            readonly
          />
        </div>
        <div>
          <div class="settings-label">接口地址</div>
          <input
            type="text"
            class="settings-input settings-input--mb10"
            data-custom-provider-field="apiUrl"
            data-custom-provider-id="${escapeHtml(provider.id)}"
            value="${escapeHtml(provider.config.apiUrl)}"
            placeholder="https://api.example.com"
          />
        </div>
        <div>
          <div class="settings-label">自定义视频端点（可选，高级）</div>
          <input
            type="hidden"
            data-custom-provider-field="videoEndpointPreset"
            data-custom-provider-id="${escapeHtml(provider.id)}"
            value="${escapeHtml(provider.endpointPresets?.video || CUSTOM_PROVIDER_DEFAULT_VIDEO_ENDPOINT_PRESET)}"
          />
          <input
            type="text"
            class="settings-input settings-input--mb10"
            data-custom-provider-field="videoEndpoint"
            data-custom-provider-id="${escapeHtml(provider.id)}"
            value="${escapeHtml(provider.endpoints?.video || '')}"
            placeholder="留空自动选择；特殊中转站可填 /v1/chat/completions"
          />
        </div>
        <div>
          <div class="settings-label">API 密钥</div>
          <input
            type="password"
            class="settings-input settings-input--mb10"
            data-custom-provider-field="apiKey"
            data-custom-provider-id="${escapeHtml(provider.id)}"
            value="${escapeHtml(provider.config.apiKey)}"
            placeholder="sk-..."
          />
        </div>
      </div>
      <div class="settings-custom-provider-note-field settings-input--mb10">
        <div class="settings-label">备注</div>
        <textarea
          class="settings-input settings-custom-provider-note-input"
          data-custom-provider-field="note"
          data-custom-provider-id="${escapeHtml(provider.id)}"
          rows="2"
          placeholder="例如计费说明、适用模型、接口限制等"
        >${escapeHtml(provider.note)}</textarea>
      </div>
      <div class="settings-label">启用与能力</div>
      <div class="settings-button-row settings-input--mb10">
        <button
          type="button"
          class="settings-chip-btn settings-enable-btn${enabledActiveClass}"
          data-custom-provider-enabled-toggle
          data-custom-provider-id="${escapeHtml(provider.id)}"
          aria-pressed="${enabledPressed}"
        >
          ${escapeHtml(enabledLabel)}
        </button>
        <input
          type="checkbox"
          class="settings-hidden-control"
          data-custom-provider-field="enabled"
          data-custom-provider-id="${escapeHtml(provider.id)}"
          ${enabledChecked}
        />
        ${CUSTOM_PROVIDER_CAPABILITIES.map(capability => renderCapabilityOption(provider.id, capabilities, capability)).join('')}
      </div>
      <div class="settings-label">模型配置</div>
        <div class="settings-model-button-grid settings-input--mb10">
          ${CUSTOM_PROVIDER_MODEL_CAPABILITIES.map(capability => renderModelButton(provider.id, provider.models, capability)).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderProviders(providers) {
  const list = getList();
  if (!list) {
    return;
  }
  list.innerHTML = providers.length > 0 ? providers.map(renderProviderCard).join('') : '';
}

function notifyProviderEdited(providerId = '') {
  markSettingsUnsavedChanges();
  if (typeof bindingState.onProviderEdited === 'function' && providerId) {
    bindingState.onProviderEdited(providerId);
  }
}

function rerenderFromDom() {
  const providers = readProvidersFromDom();
  renderProviders(providers);
}

function createProviderFromCurrentDom() {
  const provider = createEmptyProvider();
  const providers = readProvidersFromDom();
  providers.unshift(provider);
  expandedCustomProviderIds.add(provider.id);
  renderProviders(providers);
  notifyProviderEdited(provider.id);
}

function removeProviderFromDom(providerId) {
  expandedCustomProviderIds.delete(providerId);
  const providers = readProvidersFromDom().filter(provider => provider.id !== providerId);
  renderProviders(providers);
}

function toggleProviderCollapsed(button) {
  const providerId = normalizeString(button?.dataset?.customProviderCollapse);
  const card = button?.closest('[data-custom-provider-card]');
  if (!providerId || !card) {
    return;
  }

  const isExpanded = !expandedCustomProviderIds.has(providerId);
  if (isExpanded) {
    expandedCustomProviderIds.add(providerId);
  } else {
    expandedCustomProviderIds.delete(providerId);
  }
  card.classList.toggle('is-collapsed', !isExpanded);
  const label = isExpanded ? '收起' : '展开';
  const labelEl = button.querySelector('.settings-custom-provider-collapse-label');
  if (labelEl) {
    labelEl.textContent = label;
  }
  button.title = `${label}自定义供应商`;
  button.setAttribute('aria-label', `${label}自定义供应商`);
  button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
}

function updateConnectionTestButton(card) {
  const hasConnectionTest = !!card?.querySelector('[data-custom-provider-capability][value="connection_test"]:checked');
  const testButton = card?.querySelector('[data-provider-test]');
  if (!testButton) {
    return;
  }
  const title = hasConnectionTest
    ? `测试 ${buildCardTitle({ label: card.querySelector('[data-custom-provider-field="label"]')?.value })} 连接`
    : '未启用连接测试能力';
  testButton.disabled = !hasConnectionTest;
  testButton.title = title;
  testButton.setAttribute('aria-label', title);
}

function setToggleButtonState(button, active, activeText = '', inactiveText = '') {
  if (!button) {
    return;
  }
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  if (activeText || inactiveText) {
    button.textContent = active ? activeText : inactiveText;
  }
}

function updateModelSummary(card, capability) {
  const textarea = card?.querySelector(`[data-custom-provider-model="${capability}"]`);
  const summaryEl = card?.querySelector(`[data-custom-provider-model-summary="${capability}"]`);
  if (!textarea || !summaryEl) {
    return;
  }
  summaryEl.innerHTML = renderModelTags({ [capability]: parseModelLines(textarea.value) }, capability);
}

function removeModelTagFromCard(removeButton) {
  const capability = normalizeString(removeButton?.dataset?.customProviderModelRemove).toLowerCase();
  const model = normalizeString(removeButton?.dataset?.customProviderModelValue);
  const card = removeButton?.closest('[data-custom-provider-card]');
  const providerId = normalizeString(card?.dataset?.customProviderCard);
  const textarea = card?.querySelector(`[data-custom-provider-model="${capability}"]`);
  if (!capability || !model || !card || !textarea || !providerId) {
    return;
  }

  textarea.value = formatModelLines(parseModelLines(textarea.value).filter(item => item !== model));
  updateModelSummary(card, capability);
  notifyProviderEdited(providerId);
}

function getModelCapabilityState(card) {
  return CUSTOM_PROVIDER_MODEL_CAPABILITIES.reduce((state, capability) => {
    const textarea = card?.querySelector(`[data-custom-provider-model="${capability}"]`);
    state[capability] = parseModelLines(textarea?.value);
    return state;
  }, {});
}

function openFetchedModelsPicker(card, providerId, models) {
  if (!card) {
    return;
  }

  const currentModelsByCapability = getModelCapabilityState(card);
  const existingTargets = models.reduce((count, model) => {
    return count + CUSTOM_PROVIDER_MODEL_CAPABILITIES.filter(capability => currentModelsByCapability[capability]?.includes(model)).length;
  }, 0);
  const picker = ensureFetchedModelsPicker();
  const title = picker.querySelector('#customProviderFetchedModelsTitle');
  const desc = picker.querySelector('[data-fetched-models-desc]');
  const list = picker.querySelector('[data-fetched-models-list]');
  const providerLabel = buildCardTitle({ label: card.querySelector('[data-custom-provider-field="label"]')?.value });

  activeFetchedModelsPicker = { providerId, card };
  if (title) {
    title.textContent = `${providerLabel} · 选择模型写入位置`;
  }
  if (desc) {
    desc.textContent = `已获取 ${models.length} 个模型。接口不会可靠标注模型能力，请手动选择每个模型要加入的列表；这里只写回当前页面配置，仍需点击保存配置。`;
  }
  if (list) {
    list.innerHTML = models
      .map(model => {
        const targets = CUSTOM_PROVIDER_MODEL_CAPABILITIES.map(capability => {
          const exists = currentModelsByCapability[capability]?.includes(model);
          return `
            <label class="settings-fetched-model-target${exists ? ' is-existing' : ''}">
              <input
                type="checkbox"
                data-fetched-model-target="${escapeHtml(capability)}"
                value="${escapeHtml(model)}"
                ${exists ? 'checked disabled' : ''}
              />
              <span>${escapeHtml(MODEL_LABELS[capability] || capability)}</span>
              ${exists ? '<span class="settings-fetched-model-badge">已存在</span>' : ''}
            </label>
          `;
        }).join('');
        return `
          <div class="settings-fetched-model-item">
            <div class="settings-fetched-model-name" title="${escapeHtml(model)}">${escapeHtml(model)}</div>
            <div class="settings-fetched-model-targets">${targets}</div>
          </div>
        `;
      })
      .join('');
  }
  picker.dataset.existingTargets = String(existingTargets);
  picker.hidden = false;
  picker.classList.add('is-open');
}

function closeFetchedModelsPicker() {
  const picker = document.getElementById('customProviderFetchedModelsPicker');
  if (picker) {
    picker.hidden = true;
    picker.classList.remove('is-open');
  }
  activeFetchedModelsPicker = null;
}

function setFetchedModelsTargetSelection(capability, selected) {
  const picker = document.getElementById('customProviderFetchedModelsPicker');
  picker?.querySelectorAll(`[data-fetched-model-target="${capability}"]:not(:disabled)`).forEach(input => {
    input.checked = selected;
  });
}

function clearFetchedModelsSelection() {
  const picker = document.getElementById('customProviderFetchedModelsPicker');
  picker?.querySelectorAll('[data-fetched-model-target]:not(:disabled)').forEach(input => {
    input.checked = false;
  });
}

function saveFetchedModelsSelection() {
  if (!activeFetchedModelsPicker) {
    closeFetchedModelsPicker();
    return;
  }

  const { providerId, card } = activeFetchedModelsPicker;
  const picker = document.getElementById('customProviderFetchedModelsPicker');
  if (!card || !picker) {
    closeFetchedModelsPicker();
    return;
  }

  const selectedByCapability = CUSTOM_PROVIDER_MODEL_CAPABILITIES.reduce((accumulator, capability) => {
    accumulator[capability] = Array.from(picker.querySelectorAll(`[data-fetched-model-target="${capability}"]:checked:not(:disabled)`))
      .map(input => normalizeString(input.value));
    return accumulator;
  }, {});
  const totalSelected = Object.values(selectedByCapability).reduce((count, models) => count + models.length, 0);
  if (totalSelected === 0) {
    window.showToast?.('请选择模型要加入的列表', 'warning');
    return;
  }

  CUSTOM_PROVIDER_MODEL_CAPABILITIES.forEach(capability => {
    const selectedModels = selectedByCapability[capability];
    if (!selectedModels || selectedModels.length === 0) {
      return;
    }
    const target = card.querySelector(`[data-custom-provider-model="${capability}"]`);
    if (!target) {
      return;
    }
    const currentModels = parseModelLines(target.value);
    target.value = formatModelLines(unique([...currentModels, ...selectedModels]));
    updateModelSummary(card, capability);
  });
  notifyProviderEdited(providerId);
  closeFetchedModelsPicker();
  window.showToast?.(`已加入 ${totalSelected} 个模型配置，请保存配置`, 'success');
}

function handleFetchedModelsPickerClick(event) {
  if (event.target === event.currentTarget || event.target.closest('[data-fetched-models-close]')) {
    closeFetchedModelsPicker();
    return;
  }
  const selectTargetButton = event.target.closest('[data-fetched-models-select-target]');
  if (selectTargetButton) {
    setFetchedModelsTargetSelection(normalizeString(selectTargetButton.dataset.fetchedModelsSelectTarget), true);
    return;
  }
  if (event.target.closest('[data-fetched-models-clear]')) {
    clearFetchedModelsSelection();
    return;
  }
  if (event.target.closest('[data-fetched-models-save]')) {
    saveFetchedModelsSelection();
  }
}

function ensureFetchedModelsPicker() {
  let picker = document.getElementById('customProviderFetchedModelsPicker');
  if (picker) {
    return picker;
  }

  picker = document.createElement('div');
  picker.id = 'customProviderFetchedModelsPicker';
  picker.className = 'settings-model-editor-overlay';
  picker.hidden = true;
  picker.innerHTML = `
    <div class="settings-model-editor settings-fetched-model-picker" role="dialog" aria-modal="true" aria-labelledby="customProviderFetchedModelsTitle">
      <div class="settings-model-editor-head">
        <div>
          <div class="settings-model-editor-eyebrow">获取模型</div>
          <div class="settings-model-editor-title" id="customProviderFetchedModelsTitle">选择模型写入位置</div>
        </div>
        <button type="button" class="settings-model-editor-close" data-fetched-models-close aria-label="关闭模型选择">×</button>
      </div>
      <div class="settings-desc settings-input--mb10" data-fetched-models-desc></div>
      <div class="settings-fetched-model-toolbar">
        ${CUSTOM_PROVIDER_MODEL_CAPABILITIES.map(capability => `
          <button
            type="button"
            class="settings-fetched-model-action"
            data-fetched-models-select-target="${escapeHtml(capability)}"
          >全选${escapeHtml(MODEL_LABELS[capability] || capability)}</button>
        `).join('')}
        <button type="button" class="settings-fetched-model-action" data-fetched-models-clear>清空选择</button>
      </div>
      <div class="settings-fetched-model-list" data-fetched-models-list></div>
      <div class="settings-model-editor-actions">
        <button type="button" class="settings-save-btn settings-btn-ghost" data-fetched-models-close>取消</button>
        <button type="button" class="settings-save-btn" data-fetched-models-save>加入已选模型</button>
      </div>
    </div>
  `;
  document.body.appendChild(picker);
  picker.addEventListener('click', handleFetchedModelsPickerClick);
  return picker;
}

async function fetchProviderModels(button) {
  const card = button.closest('[data-custom-provider-card]');
  const providerId = normalizeString(button.dataset.customProviderFetchModels);
  const apiUrl = normalizeString(card?.querySelector('[data-custom-provider-field="apiUrl"]')?.value);
  const apiKey = normalizeString(card?.querySelector('[data-custom-provider-field="apiKey"]')?.value).replace(/^Bearer\s+/i, '');
  if (!providerId || !card) {
    return;
  }
  if (!apiUrl) {
    window.showToast?.('请先填写接口地址', 'warn');
    return;
  }
  if (!apiKey) {
    window.showToast?.('请先填写 API 密钥', 'warn');
    return;
  }

  const modelsUrl = buildModelsFetchUrl(apiUrl);
  if (!modelsUrl) {
    window.showToast?.('接口地址不兼容，无法获取模型', 'warning');
    return;
  }

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = '获取中';
  try {
    const result = await request(
      `/api/v2/proxy/task?apiUrl=${encodeURIComponent(modelsUrl)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      30000,
    );
    if (!result?.success) {
      throw new Error(result?.error || '模型列表获取失败');
    }
    const models = extractModelIds(result.data);
    if (models.length === 0) {
      window.showToast?.('未读取到可用模型', 'warning');
      return;
    }
    openFetchedModelsPicker(card, providerId, models);
    window.showToast?.(`已获取 ${models.length} 个模型，请选择要加入的模型`, 'success');
  } catch (error) {
    window.showToast?.(`获取模型失败：${error?.message || '未知错误'}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = previousText || '获取模型';
  }
}

function ensureModelEditor() {
  let editor = document.getElementById('customProviderModelEditor');
  if (editor) {
    return editor;
  }

  editor = document.createElement('div');
  editor.id = 'customProviderModelEditor';
  editor.className = 'settings-model-editor-overlay';
  editor.hidden = true;
  editor.innerHTML = `
    <div class="settings-model-editor" role="dialog" aria-modal="true" aria-labelledby="customProviderModelEditorTitle">
      <div class="settings-model-editor-head">
        <div>
          <div class="settings-model-editor-eyebrow">自定义供应商模型</div>
          <div class="settings-model-editor-title" id="customProviderModelEditorTitle">模型配置</div>
        </div>
        <button type="button" class="settings-model-editor-close" data-custom-provider-model-close aria-label="关闭模型配置">×</button>
      </div>
      <div class="settings-desc settings-input--mb10" data-custom-provider-model-editor-desc></div>
      <textarea
        class="settings-input settings-model-editor-textarea"
        data-custom-provider-model-editor-input
        rows="10"
        placeholder="每行一个模型名称，例如 gpt-4o-mini"
      ></textarea>
      <div class="settings-model-editor-actions">
        <button type="button" class="settings-save-btn settings-btn-ghost" data-custom-provider-model-close>取消</button>
        <button type="button" class="settings-save-btn" data-custom-provider-model-save>保存模型</button>
      </div>
    </div>
  `;
  document.body.appendChild(editor);
  editor.addEventListener('click', handleModelEditorClick);
  return editor;
}

function openModelEditor(card, capability) {
  const providerId = normalizeString(card?.dataset?.customProviderCard);
  const textarea = card?.querySelector(`[data-custom-provider-model="${capability}"]`);
  if (!providerId || !textarea) {
    return;
  }

  const editor = ensureModelEditor();
  const input = editor.querySelector('[data-custom-provider-model-editor-input]');
  const title = editor.querySelector('#customProviderModelEditorTitle');
  const desc = editor.querySelector('[data-custom-provider-model-editor-desc]');
  const providerLabel = buildCardTitle({ label: card.querySelector('[data-custom-provider-field="label"]')?.value });

  activeModelEditor = { providerId, capability };
  if (title) {
    title.textContent = `${providerLabel} · ${MODEL_LABELS[capability] || capability}`;
  }
  if (desc) {
    desc.textContent = '输入自定义模型名称，每行一个；保存后会写回该供应商的模型列表。';
  }
  if (input) {
    input.value = textarea.value;
  }
  editor.hidden = false;
  editor.classList.add('is-open');
  input?.focus();
}

function closeModelEditor() {
  const editor = document.getElementById('customProviderModelEditor');
  if (editor) {
    editor.hidden = true;
    editor.classList.remove('is-open');
  }
  activeModelEditor = null;
}

function saveModelEditor() {
  if (!activeModelEditor) {
    closeModelEditor();
    return;
  }

  const { providerId, capability } = activeModelEditor;
  const editor = document.getElementById('customProviderModelEditor');
  const input = editor?.querySelector('[data-custom-provider-model-editor-input]');
  const card = getList()?.querySelector(`[data-custom-provider-card="${providerId}"]`);
  const target = card?.querySelector(`[data-custom-provider-model="${capability}"]`);
  if (!target || !card) {
    closeModelEditor();
    return;
  }

  target.value = formatModelLines(parseModelLines(input?.value));
  updateModelSummary(card, capability);
  notifyProviderEdited(providerId);
  closeModelEditor();
}

function handleModelEditorClick(event) {
  if (event.target === event.currentTarget || event.target.closest('[data-custom-provider-model-close]')) {
    closeModelEditor();
    return;
  }
  if (event.target.closest('[data-custom-provider-model-save]')) {
    saveModelEditor();
  }
}

function toggleProviderEnabled(button) {
  const card = button.closest('[data-custom-provider-card]');
  const input = card?.querySelector('[data-custom-provider-field="enabled"]');
  const providerId = normalizeString(button.dataset.customProviderId);
  if (!input || !providerId) {
    return;
  }
  input.checked = !input.checked;
  setToggleButtonState(button, input.checked, '已启用', '已停用');
  notifyProviderEdited(providerId);
}

function toggleProviderCapability(button) {
  const capability = normalizeString(button.dataset.customProviderCapabilityToggle).toLowerCase();
  const card = button.closest('[data-custom-provider-card]');
  const input = card?.querySelector(`[data-custom-provider-capability][value="${capability}"]`);
  const providerId = normalizeString(button.dataset.customProviderId);
  if (!input || !providerId) {
    return;
  }
  input.checked = !input.checked;
  setToggleButtonState(button, input.checked);
  updateConnectionTestButton(card);
  notifyProviderEdited(providerId);
}

function handleListClick(event) {
  const collapseButton = event.target.closest('[data-custom-provider-collapse]');
  if (collapseButton) {
    toggleProviderCollapsed(collapseButton);
    return;
  }

  const removeButton = event.target.closest('[data-custom-provider-remove]');
  if (removeButton) {
    const providerId = normalizeString(removeButton.dataset.customProviderRemove);
    if (providerId) {
      removeProviderFromDom(providerId);
      notifyProviderEdited(providerId);
    }
    return;
  }

  const enabledButton = event.target.closest('[data-custom-provider-enabled-toggle]');
  if (enabledButton) {
    toggleProviderEnabled(enabledButton);
    return;
  }

  const capabilityButton = event.target.closest('[data-custom-provider-capability-toggle]');
  if (capabilityButton) {
    toggleProviderCapability(capabilityButton);
    return;
  }

  const modelRemoveButton = event.target.closest('[data-custom-provider-model-remove]');
  if (modelRemoveButton) {
    event.preventDefault();
    event.stopPropagation();
    removeModelTagFromCard(modelRemoveButton);
    return;
  }

  const modelButton = event.target.closest('[data-custom-provider-model-open]');
  if (modelButton) {
    const capability = normalizeString(modelButton.dataset.customProviderModelOpen).toLowerCase();
    const card = modelButton.closest('[data-custom-provider-card]');
    openModelEditor(card, capability);
    return;
  }

  const fetchModelsButton = event.target.closest('[data-custom-provider-fetch-models]');
  if (fetchModelsButton) {
    fetchProviderModels(fetchModelsButton);
    return;
  }

  const testButton = event.target.closest('[data-provider-test]');
  if (!testButton) {
    return;
  }
  const providerId = normalizeString(testButton.dataset.providerTest);
  if (!isCustomProviderId(providerId)) {
    return;
  }
  if (typeof bindingState.onProviderTest === 'function') {
    bindingState.onProviderTest(testButton, providerId);
  }
}

function handleListKeydown(event) {
  const modelRemoveButton = event.target.closest('[data-custom-provider-model-remove]');
  if (!modelRemoveButton) {
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  removeModelTagFromCard(modelRemoveButton);
}

function handleListInput(event) {
  const target = event.target;
  const providerId = normalizeString(target?.dataset?.customProviderId);
  if (!providerId) {
    return;
  }

  if (target.matches('[data-custom-provider-field="label"]')) {
    const card = target.closest('[data-custom-provider-card]');
    const titleEl = card?.querySelector('.settings-card-title');
    if (titleEl) {
      titleEl.textContent = buildCardTitle({ label: target.value });
    }
    updateConnectionTestButton(card);
  }

  if (target.matches('[data-custom-provider-field="apiUrl"]')) {
    const card = target.closest('[data-custom-provider-card]');
    const subtitleEl = card?.querySelector('.settings-custom-provider-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = normalizeString(target.value) || normalizeString(card?.dataset?.customProviderCard);
    }
  }

  if (target.matches('[data-custom-provider-capability]')) {
    updateConnectionTestButton(target.closest('[data-custom-provider-card]'));
  }

  notifyProviderEdited(providerId);
}

export function bindCustomProviderSettings({ onProviderTest, onProviderEdited } = {}) {
  bindingState.onProviderTest = typeof onProviderTest === 'function' ? onProviderTest : null;
  bindingState.onProviderEdited = typeof onProviderEdited === 'function' ? onProviderEdited : null;

  if (bindingState.bound) {
    return;
  }

  const addButton = getAddButton();
  const list = getList();
  if (!addButton || !list) {
    return;
  }

  addButton.addEventListener('click', () => {
    createProviderFromCurrentDom();
    notifyProviderEdited();
  });
  list.addEventListener('click', handleListClick);
  list.addEventListener('keydown', handleListKeydown);
  list.addEventListener('input', handleListInput);
  list.addEventListener('change', handleListInput);
  bindingState.bound = true;
}

export function renderCustomProviderSettings(config = {}) {
  const host = getHost();
  if (!host) {
    return;
  }
  renderProviders(normalizeProvidersForView(config));
}

export function mergeCustomProviderSettings(config = {}) {
  const nextConfig = isPlainObject(config) ? JSON.parse(JSON.stringify(config)) : {};
  const providers = readProvidersFromDom();
  const nextProviders = isPlainObject(nextConfig.providers) ? { ...nextConfig.providers } : {};

  for (const providerId of Object.keys(nextProviders)) {
    if (isCustomProviderId(providerId)) {
      delete nextProviders[providerId];
    }
  }

  nextConfig.customProviders = providers.map(provider => ({
    id: provider.id,
    label: provider.label,
    note: provider.note,
    kind: 'openai-compatible',
    enabled: provider.enabled !== false,
    capabilities: unique(provider.capabilities),
    models: { ...provider.models },
    endpoints: { ...provider.endpoints },
    endpointPresets: { ...provider.endpointPresets },
  }));

  for (const provider of providers) {
    nextProviders[provider.id] = {
      ...(isPlainObject(config?.providers?.[provider.id]) ? config.providers[provider.id] : {}),
      apiUrl: provider.config.apiUrl,
      apiKey: provider.config.apiKey,
      modelApiKey: provider.config.modelApiKey,
      enabled: provider.enabled !== false,
    };
  }

  nextConfig.providers = nextProviders;
  return nextConfig;
}

export function getCustomProviderIdsForTesting(config = {}) {
  const providers = readProvidersFromDom();
  const source = providers.length > 0 ? providers : normalizeProvidersForView(config);
  return source
    .filter(provider => provider.enabled !== false)
    .filter(provider => provider.capabilities.includes(ENABLED_CAPABILITY))
    .filter(provider => normalizeString(provider.config.apiKey) || normalizeString(provider.config.modelApiKey))
    .map(provider => provider.id);
}

export function resetCustomProviderStatuses(providerId = '') {
  const ids = providerId ? [providerId] : readProvidersFromDom().map(provider => provider.id);
  for (const id of ids) {
    const statusEl = document.getElementById(`providerTestStatus-${id}`);
    const balanceEl = document.getElementById(`providerBalance-${id}`);
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.className = 'settings-provider-status settings-provider-status--test';
      statusEl.removeAttribute('data-provider-test-tooltip');
      statusEl.removeAttribute('aria-label');
      statusEl.removeAttribute('data-native-title');
    }
    if (balanceEl) {
      balanceEl.hidden = true;
      balanceEl.textContent = '';
      balanceEl.removeAttribute('aria-label');
      balanceEl.removeAttribute('data-native-title');
    }
  }
}