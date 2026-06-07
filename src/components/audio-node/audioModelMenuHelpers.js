import { getModelsByKind } from '../../manifests/index.js';
import {
  buildRuntimeProviderBadgeHTML,
  getRuntimeCustomProviderMenuGroups,
} from '../../modules/runtimeProviderMenus.js';
import { renderNodeModelMenu, renderNodeModelTrigger } from '../shared/nodeModelMenu.js';

function getAudioMenuMeta(manifest) {
  const audioMenu = manifest?.extensions?.audioMenu;
  return audioMenu && typeof audioMenu === 'object' ? audioMenu : null;
}

function isAudioModelMenuManifest(manifest) {
  const audioMenu = getAudioMenuMeta(manifest);
  if (audioMenu?.group !== 'runninghubWorkflow') return false;
  if (manifest?.provider !== 'runninghubwf') return false;
  const uiPlacement = Array.isArray(manifest?.uiPlacement)
    ? manifest.uiPlacement
    : ['modelMenu'];
  return !(uiPlacement.includes('toolbar') && !uiPlacement.includes('modelMenu'));
}

export function getAudioWorkflowMenuManifests() {
  return getModelsByKind('audio')
    .filter(isAudioModelMenuManifest)
    .sort((left, right) => {
      const leftOrder = Number(getAudioMenuMeta(left)?.order);
      const rightOrder = Number(getAudioMenuMeta(right)?.order);
      const normalizedLeftOrder = Number.isFinite(leftOrder) ? leftOrder : 0;
      const normalizedRightOrder = Number.isFinite(rightOrder) ? rightOrder : 0;
      if (normalizedLeftOrder !== normalizedRightOrder) {
        return normalizedLeftOrder - normalizedRightOrder;
      }
      return String(left.modelId || '').localeCompare(String(right.modelId || ''));
    });
}

export function buildAudioWorkflowItems(validators = {}) {
  return getAudioWorkflowMenuManifests().map((manifest) =>
    Object.freeze({
      key: manifest.modelId,
      label: manifest.label,
      subtitle: manifest.description || '',
      vip: manifest.vip === true,
      validate: validators[manifest.modelId] || (() => ''),
    }),
  );
}

function buildRuntimeAudioGroups() {
  return getRuntimeCustomProviderMenuGroups('audio').map((group) => ({
    id: group.provider,
    label: group.label || group.provider,
    subtitle: '自定义音频模型',
    iconHtml: group.badgeHtml || buildRuntimeProviderBadgeHTML(group.provider, 14),
    items: group.models.map((item) => ({
      modelId: item.modelId,
      provider: item.provider,
      label: item.title || item.rawModelId || item.modelId,
      subtitle: item.subtitle || item.providerLabel || '自定义供应商',
      iconHtml: group.smallBadgeHtml || buildRuntimeProviderBadgeHTML(item.provider, 12),
    })),
  }));
}

export function buildAudioModelMenuHtml({ activeModel = '', workflowItems = [] } = {}) {
  return renderNodeModelMenu({
    kind: 'audio',
    activeModel,
    groups: [
      {
        id: 'runninghubwf',
        label: 'RunningHUB工作流',
        subtitle: '音频生成工作流',
        icon: 'images/RH.png',
        iconAlt: 'runninghub',
        items: workflowItems.map((item) => ({
          modelId: item.key,
          provider: 'runninghubwf',
          label: item.label,
          subtitle: item.subtitle,
          icon: 'images/RH.png',
          iconAlt: 'runninghubwf',
          vip: item.vip === true,
        })),
      },
      ...buildRuntimeAudioGroups(),
    ],
  });
}

export function buildAudioModelTriggerHtml({ label = '', provider = '' } = {}) {
  const providerId = String(provider || '').trim();
  const iconHtml = providerId.startsWith('custom_')
    ? buildRuntimeProviderBadgeHTML(providerId, 14)
    : '<img src="images/RH.png" style="width:14px;height:14px;object-fit:contain;border-radius:3px;flex-shrink:0;" alt="runninghub">';
  return renderNodeModelTrigger({ iconHtml, label });
}