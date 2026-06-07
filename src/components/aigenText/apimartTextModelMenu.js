import { getModelsByKind } from '../../manifests/index.js';
import { getTextProviderMenuGroups } from '../../manifests/text/textProviderMenuGroups.js';
import { getDisplayModelName, isRuntimeCustomProviderId } from '../../modules/providers.js';
import {
  buildRuntimeProviderBadgeHTML,
  getRuntimeCustomProviderMenuGroups,
  getRuntimeCustomProviderMenuItems,
} from '../../modules/runtimeProviderMenus.js';
import { renderNodeMenuGroup, renderNodeMenuItem } from '../shared/nodeModelMenu.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function getTextMenuMeta(manifest) {
  const textMenu = manifest?.extensions?.textMenu;
  return textMenu && typeof textMenu === 'object' ? textMenu : null;
}

function resolveBuiltInTextIcon(manifest) {
  const textMenu = getTextMenuMeta(manifest);
  if (textMenu?.icon) {
    return textMenu.icon;
  }

  const modelId = normalizeText(manifest?.modelId).toLowerCase();
  if (modelId.includes('deepseek')) {
    return 'deepseek';
  }
  if (modelId.includes('gpt')) {
    return 'oa';
  }
  if (modelId.includes('gemini')) {
    return 'gemini';
  }
  if (modelId.includes('qwen')) {
    return 'qwen';
  }
  if (modelId.includes('kimi')) {
    return 'moonshot';
  }

  const providerId = normalizeText(manifest?.provider).toLowerCase();
  if (providerId === 'runninghub') {
    return 'runninghub';
  }
  if (providerId === 'grsai') {
    return 'grsai';
  }
  if (providerId === 'ppio') {
    return 'ppio';
  }
  if (providerId === 'volcengine') {
    return 'volcengine';
  }
  return providerId === 'apimart' ? 'am' : providerId || 'am';
}

function buildTextModelItem(manifest) {
  const textMenu = getTextMenuMeta(manifest) || {};
  const providerId = normalizeText(manifest?.provider);
  const title = textMenu.label || getDisplayModelName(manifest?.modelId) || manifest?.modelId;
  const subtitle = textMenu.subtitle || manifest?.description || '';
  const isCustomProvider = isRuntimeCustomProviderId(providerId);
  return Object.freeze({
    modelId: manifest.modelId,
    provider: providerId,
    title,
    subtitle,
    icon: isCustomProvider ? providerId : resolveBuiltInTextIcon(manifest),
    iconHtml: isCustomProvider ? buildRuntimeProviderBadgeHTML(providerId, 14) : '',
    smallIconHtml: isCustomProvider ? buildRuntimeProviderBadgeHTML(providerId, 12) : '',
    customProvider: isCustomProvider,
  });
}

function getBuiltInTextModelManifests(providerId) {
  const normalizedProviderId = normalizeText(providerId).toLowerCase();
  return getModelsByKind('text')
    .filter(manifest => {
      const manifestProviderId = normalizeText(manifest?.provider).toLowerCase();
      if (!manifestProviderId || manifestProviderId !== normalizedProviderId) {
        return false;
      }
      if (isRuntimeCustomProviderId(manifestProviderId)) {
        return false;
      }
      const textMenu = getTextMenuMeta(manifest);
      return !textMenu?.provider || normalizeText(textMenu.provider).toLowerCase() === normalizedProviderId;
    })
    .sort((left, right) => {
      const leftMeta = getTextMenuMeta(left);
      const rightMeta = getTextMenuMeta(right);
      const leftOrder = Number(leftMeta?.order || 0);
      const rightOrder = Number(rightMeta?.order || 0);
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return getDisplayModelName(left?.modelId).localeCompare(getDisplayModelName(right?.modelId), 'zh-CN');
    });
}

export function getTextModelMenuItems(providerId) {
  return getBuiltInTextModelManifests(providerId).map(buildTextModelItem);
}

function buildBuiltInProviderItemMap() {
  const map = {};
  for (const group of getTextProviderMenuGroups()) {
    map[group.id] = Object.freeze(getTextModelMenuItems(group.id));
  }
  return Object.freeze(map);
}

export const TEXT_MODEL_MENU_ITEMS_BY_PROVIDER = buildBuiltInProviderItemMap();

export const TEXT_MODEL_IDS_BY_PROVIDER = Object.freeze(
  Object.fromEntries(
    Object.entries(TEXT_MODEL_MENU_ITEMS_BY_PROVIDER).map(([providerId, items]) => [
      providerId,
      Object.freeze(items.map(item => item.modelId)),
    ]),
  ),
);

export const TEXT_MODEL_DISPLAY_NAME_MAP = Object.freeze(
  Object.fromEntries(
    Object.values(TEXT_MODEL_MENU_ITEMS_BY_PROVIDER)
      .flat()
      .map(item => [item.modelId, item.title]),
  ),
);

export const APIMART_TEXT_MODEL_MENU_ITEMS = Object.freeze(
  TEXT_MODEL_MENU_ITEMS_BY_PROVIDER.apimart || [],
);
export const APIMART_TEXT_MODEL_IDS = Object.freeze(TEXT_MODEL_IDS_BY_PROVIDER.apimart || []);
export const APIMART_TEXT_MODEL_DISPLAY_NAME_MAP = Object.freeze(
  Object.fromEntries(APIMART_TEXT_MODEL_MENU_ITEMS.map(item => [item.modelId, item.title])),
);
export const RUNNINGHUB_TEXT_MODEL_MENU_ITEMS = Object.freeze(
  TEXT_MODEL_MENU_ITEMS_BY_PROVIDER.runninghub || [],
);
export const RUNNINGHUB_TEXT_MODEL_IDS = Object.freeze(
  TEXT_MODEL_IDS_BY_PROVIDER.runninghub || [],
);
export const VOLCENGINE_TEXT_MODEL_MENU_ITEMS = Object.freeze(
  TEXT_MODEL_MENU_ITEMS_BY_PROVIDER.volcengine || [],
);
export const VOLCENGINE_TEXT_MODEL_IDS = Object.freeze(
  TEXT_MODEL_IDS_BY_PROVIDER.volcengine || [],
);

export function getRuntimeCustomTextMenuItems() {
  return getRuntimeCustomProviderMenuItems('text').map(item => ({
    ...item,
    iconHtml: buildRuntimeProviderBadgeHTML(item.provider, 14),
    smallIconHtml: buildRuntimeProviderBadgeHTML(item.provider, 12),
    customProvider: true,
  }));
}

export function findTextModelMenuItem(modelId) {
  const normalizedModelId = normalizeText(modelId);
  if (!normalizedModelId) {
    return null;
  }

  return (
    Object.values(TEXT_MODEL_MENU_ITEMS_BY_PROVIDER)
      .flat()
      .find(item => item.modelId === normalizedModelId) ||
    getRuntimeCustomTextMenuItems().find(item => item.modelId === normalizedModelId) ||
    null
  );
}

export function buildTextModelIconHTML(icon, size = 20) {
  const normalizedSize = Math.max(10, Number(size) || 20);
  const className = normalizedSize <= 12 ? 'text-model-icon-small' : 'text-model-icon';
  if (icon === 'deepseek') {
    return `<img src="images/deepseek.svg" class="${className}" alt="deepseek">`;
  }
  if (icon === 'gemini') {
    return `<img src="images/gemini.svg" class="${className}" alt="gemini">`;
  }
  if (icon === 'qwen') {
    return `<img src="images/qwen.svg" class="${className}" alt="qwen">`;
  }
  if (icon === 'grsai') {
    return `<img src="images/grsai.png" class="${className} text-model-icon-padded" alt="grsai">`;
  }
  if (icon === 'ppio') {
    return `<img src="images/ppio.png" class="${className}" alt="ppio">`;
  }
  if (icon === 'runninghub') {
    return `<img src="images/RH.png" class="${className}" alt="runninghub">`;
  }
  if (icon === 'volcengine') {
    return `<img src="images/volcengine.svg" class="${className}" alt="volcengine">`;
  }
  if (icon === 'moonshot') {
    return `<div class="${className} text-model-icon-badge text-model-icon-moonshot"><span>M</span></div>`;
  }
  const badge = icon === 'oa' ? 'OA' : 'AM';
  return `<div class="${className} text-model-icon-badge">${badge}</div>`;
}

export function buildTextModelSmallIconHTML(modelId) {
  const item = findTextModelMenuItem(modelId);
  if (!item) {
    return '';
  }
  if (item.smallIconHtml) {
    return item.smallIconHtml;
  }
  return buildTextModelIconHTML(item.icon, 12);
}

export function buildTextModelMenuHTML(activeModel, providerId) {
  const items = TEXT_MODEL_MENU_ITEMS_BY_PROVIDER[normalizeText(providerId).toLowerCase()] || [];
  return items
    .map(item =>
      renderNodeMenuItem(
        {
          modelId: item.modelId,
          provider: item.provider,
          label: item.title,
          subtitle: item.subtitle,
          iconHtml: item.iconHtml || buildTextModelIconHTML(item.icon, 20),
        },
        { activeModel },
      ),
    )
    .join('');
}

export function buildRuntimeCustomTextMenuHTML(activeModel) {
  return getRuntimeCustomTextMenuItems()
    .map(item =>
      renderNodeMenuItem(
        {
          modelId: item.modelId,
          provider: item.provider,
          label: item.title,
          subtitle: item.subtitle,
          iconHtml: item.iconHtml,
          className: 'custom-provider-menu-item',
        },
        { activeModel },
      ),
    )
    .join('');
}

export function buildTextProviderMenuGroupsHTML(activeModel, options = {}) {
  const providerFilter = Array.isArray(options.providers)
    ? new Set(options.providers.map(providerId => normalizeText(providerId).toLowerCase()))
    : null;
  const builtInGroups = getTextProviderMenuGroups()
    .filter(group => !providerFilter || providerFilter.has(group.id))
    .map(group =>
      renderNodeMenuGroup(
        {
          id: group.id,
          headerClass: `${group.id}-group-header`,
          submenuClass: `${group.id}-submenu`,
          toggleAttr: `data-${group.id}-toggle`,
          label: group.label,
          subtitle: group.subtitle,
          iconHtml:
            group.icon === 'runninghub'
              ? '<img src="images/RH.png" class="text-model-icon" alt="runninghub">'
              : buildTextModelIconHTML(group.icon, 20),
          itemsHtml: buildTextModelMenuHTML(activeModel, group.id),
        },
        { activeModel },
      ),
    );

  if (options.includeCustomProviders !== true) {
    return builtInGroups.join('');
  }

  const customGroups = getRuntimeCustomProviderMenuGroups('text').map(group =>
    renderNodeMenuGroup(
      {
        id: group.id,
        headerClass: `${group.id}-group-header`,
        submenuClass: `${group.id}-submenu`,
        toggleAttr: `data-${group.id}-toggle`,
        label: group.label,
        subtitle: group.subtitle,
        iconHtml: group.badgeHtml,
        items: group.models.map(item => ({
          modelId: item.modelId,
          provider: item.provider,
          label: item.title,
          subtitle: item.subtitle,
          iconHtml: buildRuntimeProviderBadgeHTML(item.provider, 14),
        })),
      },
      { activeModel },
    ),
  );

  return [...builtInGroups, ...customGroups].join('');
}

export function buildApimartTextModelMenuHTML(activeModel) {
  return buildTextModelMenuHTML(activeModel, 'apimart');
}

export function buildRunningHubTextModelMenuHTML(activeModel) {
  return buildTextModelMenuHTML(activeModel, 'runninghub');
}