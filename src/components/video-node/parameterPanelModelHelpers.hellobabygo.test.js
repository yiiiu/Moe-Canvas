import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFixedInputAssetSlotMapFromRefs,
  getFixedInputSlotConfigFromManifest,
  resolveFixedInputSlotForRef,
} from '../../modules/fixedInputAssetRefs.js';
import { buildRuntimeProviderBadgeHTML } from '../../modules/runtimeProviderMenus.js';
import { buildModelUiSchemaDefaultParams, hasModelUiSchema, renderModelUiSchemaControls } from '../aigenImage/uiSchemaRenderer.js';
import { getModelsByKind } from '../../manifests/index.js';
import {
  buildHellobabyGoVideoLogoHTML,
  buildHellobabyGoVideoMenuGroups,
  getHellobabyGoVideoMenuLabel,
} from './parameterPanelModelHelpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parameterPanelModuleSource = readFileSync(join(__dirname, 'parameterPanelModule.js'), 'utf8');

function extractMenuModelOrder(html) {
  return Array.from(String(html || '').matchAll(/data-value="([^"]+)"/g)).map(match => match[1]);
}

test('video node model menu includes built-in HelloBabyGo provider models', () => {
  const manifestModelIds = getModelsByKind('video')
    .filter(model => model.provider === 'hellobabygo')
    .map(model => model.modelId);

  assert.ok(manifestModelIds.length > 0);

  const groups = buildHellobabyGoVideoMenuGroups('hellobabygo/omni_flash');

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'hellobabygo-video');
  assert.equal(groups[0].label, '斑点蛙');
  assert.equal(groups[0].subtitle, '内置视频模型 API');

  const menuModelIds = extractMenuModelOrder(groups[0].itemsHtml);
  assert.deepEqual(menuModelIds, manifestModelIds);
  assert.match(groups[0].itemsHtml, /data-provider="hellobabygo"/);
  assert.match(groups[0].itemsHtml, /class="floating-menu-item node-menu-item active" data-value="hellobabygo\/omni_flash" data-provider="hellobabygo"/);
  assert.match(groups[0].itemsHtml, /<div class="fmi-title">Omni Flash<\/div>/);
  assert.doesNotMatch(groups[0].itemsHtml, /<div class="fmi-title">斑点蛙 /);

  assert.match(parameterPanelModuleSource, /\.\.\.buildHellobabyGoVideoMenuGroups\(/);
});

test('video node HelloBabyGo trigger uses provider badge and model-only label', () => {
  const label = getHellobabyGoVideoMenuLabel('斑点蛙 VEO 3.1 Fast Landscape 首尾图 HD');
  const iconHtml = buildHellobabyGoVideoLogoHTML(12);

  assert.equal(label, 'VEO 3.1 Fast Landscape 首尾图 HD');
  assert.match(iconHtml, /node-menu-icon-small node-menu-icon-badge/);
  assert.match(iconHtml, />斑<\/div>/);
  assert.match(parameterPanelModuleSource, /buildHellobabyGoVideoLogoHTML\(0xc\)/);
  assert.match(parameterPanelModuleSource, /getHellobabyGoVideoMenuLabel\(_0x5e7afa\(_0x200f4c\)\)/);
  assert.doesNotMatch(parameterPanelModuleSource, /renderNodeModelTrigger\(\{'iconHtml':_0x44e9ec,'label':_0x5e7afa\(_0x200f4c\)\}\)/);
});

test('video node custom provider trigger uses runtime provider badge instead of video fallback badge', () => {
  const iconHtml = buildRuntimeProviderBadgeHTML('custom_acme', 12);

  assert.match(iconHtml, /custom-provider-badge/);
  assert.match(iconHtml, />CA<\/div>/);
  assert.match(parameterPanelModuleSource, /isRuntimeCustomProviderId\(_0x36bf57\)/);
  assert.match(parameterPanelModuleSource, /buildRuntimeProviderBadgeHTML\(_0x36bf57,0xc\)/);
});

test('video node renders HelloBabyGo quality ratio popup in the footer parameter area', () => {
  const modelId = 'hellobabygo/grok-imagine-video-1.5-preview';

  assert.equal(hasModelUiSchema(modelId, { placement: 'resolution' }), true);

  const html = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'resolution' });

  assert.match(html, /ui-schema-quality-ratio-pill/);
  assert.match(html, /data-ui-schema-composite-field="qualityRatio"/);
  assert.match(html, /data-ui-schema-menu-trigger="qualityRatio"/);
  assert.match(html, /ui-schema-quality-ratio-popup/);
  assert.match(html, />\s*自适应 · 720p\s*</);
  assert.match(html, /data-ui-schema-field="resolution"/);
  assert.match(html, />视频分辨率</);
  assert.match(html, /data-ui-schema-value="720p"/);
  assert.match(html, /data-ui-schema-value="1080p"/);
  assert.match(html, /data-ui-schema-value="4K"/);
  assert.match(html, /data-ui-schema-field="aspectRatio"/);
  assert.match(html, />比例</);
  assert.match(html, /data-ui-schema-value="auto"/);
  assert.match(html, />自适应</);
  assert.match(html, /data-ui-schema-value="16:9"/);
  assert.match(html, /data-ui-schema-value="9:16"/);
  assert.doesNotMatch(html, /data-ui-schema-menu-trigger="aspectRatio"/);
});

test('video node HelloBabyGo Grok uses 10 second default with 10 and 15 second options', () => {
  const modelId = 'hellobabygo/grok-imagine-video-1.5-preview';
  const defaults = buildModelUiSchemaDefaultParams(modelId);
  const html = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'resolution' });

  assert.equal(defaults.aspectRatio, 'auto');
  assert.equal(defaults.resolution, '720p');
  assert.equal(defaults.seconds, '10');
  assert.match(html, /data-ui-schema-field="seconds"[^>]*data-ui-schema-default="10"/);
  assert.match(html, /data-ui-schema-value="10"[^>]*>10秒<\/button>/);
  assert.match(html, /data-ui-schema-value="15"[^>]*>15秒<\/button>/);
  assert.doesNotMatch(html, /data-ui-schema-value="8"[^>]*>8秒<\/button>/);
});

test('video node HelloBabyGo VEO uses read-only duration field fixed to 8s', () => {
  const modelId = 'hellobabygo/veo_3_1-fast-landscape';
  const model = getModelsByKind('video').find(item => item.modelId === modelId);
  const durationField = model?.uiSchema?.fields?.find(field => field.id === 'duration');
  const defaults = buildModelUiSchemaDefaultParams(modelId);
  const html = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'resolution' });

  assert.equal(defaults.aspectRatio, 'auto');
  assert.equal(defaults.resolution, '720p');
  assert.equal(defaults.duration, '8');
  assert.equal(defaults.seconds, undefined);
  assert.equal(durationField?.readOnly, true);
  assert.deepEqual(durationField?.options, [{ value: '8', label: '8s' }]);
  assert.match(html, /data-ui-schema-field="duration"[^>]*data-ui-schema-default="8"/);
  assert.doesNotMatch(html, /data-ui-schema-field="seconds"[^>]*data-ui-schema-default="8"/);
  assert.match(html, /data-ui-schema-value="8"[^>]*>8s<\/button>/);
  assert.doesNotMatch(html, /data-ui-schema-value="10"[^>]*>10秒<\/button>/);
});

test('video node HelloBabyGo VEO places mode selector immediately after model selector', () => {
  const modelId = 'hellobabygo/veo_3_1-fast-landscape';
  const model = getModelsByKind('video').find(item => item.modelId === modelId);

  assert.deepEqual(model?.uiSchema?.footerPlacementOrder, ['mode', 'resolution']);
});

test('video node HelloBabyGo VEO exposes generation mode selector and mode-driven upload slots', () => {
  const modelId = 'hellobabygo/veo_3_1-fast-landscape';
  const model = getModelsByKind('video').find(item => item.modelId === modelId);
  const defaults = buildModelUiSchemaDefaultParams(modelId);
  const html = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'mode' });

  assert.ok(model);
  assert.equal(defaults.mode, 'fast');
  assert.equal(defaults.generation_type, 'text');
  assert.match(html, /ui-schema-section-pair-pill/);
  assert.match(html, /data-ui-schema-field="mode"/);
  assert.match(html, />模型选择</);
  assert.match(html, /data-ui-schema-value="fast"[^>]*>fast<\/button>/);
  assert.match(html, /data-ui-schema-field="generation_type"/);
  assert.match(html, />模式选择</);
  assert.match(html, /data-ui-schema-value="text"[^>]*>文生视频<\/button>/);
  assert.match(html, /data-ui-schema-value="text_hd"[^>]*>高清<\/button>/);
  assert.match(html, /data-ui-schema-value="frame"[^>]*>首尾帧<\/button>/);
  assert.match(html, /data-ui-schema-value="reference"[^>]*>参考图<\/button>/);

  assert.deepEqual(model.inputSlots.fixedSlots, [
    { id: 'firstFrame', kind: 'image', label: '首帧图', showWhen: { field: 'generation_type', value: 'frame' } },
    { id: 'lastFrame', kind: 'image', label: '尾帧图', showWhen: { field: 'generation_type', value: 'frame' } },
    { id: 'referenceImage1', kind: 'image', label: '参考图 1', showWhen: { field: 'generation_type', value: 'reference' } },
    { id: 'referenceImage2', kind: 'image', label: '参考图 2', showWhen: { field: 'generation_type', value: 'reference' } },
    { id: 'referenceImage3', kind: 'image', label: '参考图 3', showWhen: { field: 'generation_type', value: 'reference' } },
  ]);
  assert.equal(model.inputSlots.minByKind.image, 0);
  assert.equal(model.inputSlots.maxByKind.image, 3);

  const textConfig = getFixedInputSlotConfigFromManifest({ generationParams: { generation_type: 'text' } }, { manifest: model });
  const textHdConfig = getFixedInputSlotConfigFromManifest({ generationParams: { generation_type: 'text_hd' } }, { manifest: model });
  const frameConfig = getFixedInputSlotConfigFromManifest({ generationParams: { generation_type: 'frame' } }, { manifest: model });
  const referenceConfig = getFixedInputSlotConfigFromManifest({ generationParams: { generation_type: 'reference' } }, { manifest: model });

  assert.equal(textConfig, null);
  assert.equal(textHdConfig, null);
  assert.deepEqual(frameConfig.visibleSlots, ['firstFrame', 'lastFrame']);
  assert.deepEqual(referenceConfig.visibleSlots, ['referenceImage1', 'referenceImage2', 'referenceImage3']);
});

test('video node HelloBabyGo VEO reference mode keeps upload slots available until three images are attached', () => {
  const modelId = 'hellobabygo/veo_3_1-fast-landscape';
  const model = getModelsByKind('video').find(item => item.modelId === modelId);
  const fixedInputConfig = getFixedInputSlotConfigFromManifest({ generationParams: { generation_type: 'reference' } }, { manifest: model });
  const firstRef = { type: 'image', refSlot: 'referenceImage1', imageUrl: 'https://example.test/ref-1.jpg' };
  const secondRef = { type: 'image', refSlot: 'referenceImage2', imageUrl: 'https://example.test/ref-2.jpg' };
  const thirdRef = { type: 'image', refSlot: 'referenceImage3', imageUrl: 'https://example.test/ref-3.jpg' };

  assert.deepEqual(buildFixedInputAssetSlotMapFromRefs([firstRef], fixedInputConfig), {
    referenceImage1: { ...firstRef, refSlot: 'referenceImage1', virtual: true },
    referenceImage2: null,
    referenceImage3: null,
  });

  const legacyRef = { type: 'image', refSlot: 'referenceImages', imageUrl: 'https://example.test/legacy-ref.jpg' };
  assert.deepEqual(buildFixedInputAssetSlotMapFromRefs([legacyRef], fixedInputConfig), {
    referenceImage1: { ...legacyRef, refSlot: 'referenceImage1', virtual: true },
    referenceImage2: null,
    referenceImage3: null,
  });

  assert.equal(resolveFixedInputSlotForRef({ fixedInputConfig, kind: 'image', occupiedSlots: ['referenceImage1'] }).slot, 'referenceImage2');
  assert.equal(resolveFixedInputSlotForRef({ fixedInputConfig, kind: 'image', occupiedSlots: ['referenceImage1', 'referenceImage2'] }).slot, 'referenceImage3');
  assert.equal(resolveFixedInputSlotForRef({ fixedInputConfig, kind: 'image', occupiedSlots: ['referenceImage1', 'referenceImage2', 'referenceImage3'] }).reason, 'overflow');

  assert.deepEqual(buildFixedInputAssetSlotMapFromRefs([firstRef, secondRef, thirdRef], fixedInputConfig), {
    referenceImage1: { ...firstRef, refSlot: 'referenceImage1', virtual: true },
    referenceImage2: { ...secondRef, refSlot: 'referenceImage2', virtual: true },
    referenceImage3: { ...thirdRef, refSlot: 'referenceImage3', virtual: true },
  });
});

test('video node HelloBabyGo Omni exposes reference-only UI without mode selector', () => {
  const modelId = 'hellobabygo/omni_flash';
  const model = getModelsByKind('video').find(item => item.modelId === modelId);
  const defaults = buildModelUiSchemaDefaultParams(modelId);
  const modeHtml = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'mode' });
  const resolutionHtml = renderModelUiSchemaControls(modelId, { generationParams: {} }, { placement: 'resolution' });

  assert.ok(model);
  assert.equal(defaults.generation_type, undefined);
  assert.equal(defaults.mode, undefined);
  assert.equal(defaults.aspectRatio, 'auto');
  assert.equal(defaults.resolution, '720p');
  assert.equal(defaults.seconds, '10');
  assert.equal(modeHtml, '');
  assert.doesNotMatch(resolutionHtml, /data-ui-schema-field="generation_type"/);
  assert.doesNotMatch(resolutionHtml, /data-ui-schema-field="mode"/);
  assert.match(resolutionHtml, /ui-schema-quality-ratio-pill/);
  assert.match(resolutionHtml, /data-ui-schema-composite-field="qualityRatio"/);
  assert.match(resolutionHtml, />\s*自适应 · 720p\s*</);

  assert.deepEqual(model.inputSlots.fixedSlots, [
    { id: 'referenceImage1', kind: 'image', label: '参考图 1', required: true },
    { id: 'referenceImage2', kind: 'image', label: '参考图 2' },
    { id: 'referenceImage3', kind: 'image', label: '参考图 3' },
    { id: 'referenceImage4', kind: 'image', label: '参考图 4' },
    { id: 'referenceImage5', kind: 'image', label: '参考图 5' },
    { id: 'referenceImage6', kind: 'image', label: '参考图 6' },
    { id: 'referenceImage7', kind: 'image', label: '参考图 7' },
  ]);
  assert.equal(model.inputSlots.minByKind.image, 1);
  assert.equal(model.inputSlots.maxByKind.image, 7);

  const fixedInputConfig = getFixedInputSlotConfigFromManifest({}, { manifest: model });
  const refs = Array.from({ length: 6 }, (_, index) => ({
    type: 'image',
    refSlot: `referenceImage${index + 1}`,
    imageUrl: `https://example.test/omni-ref-${index + 1}.jpg`,
  }));

  assert.deepEqual(fixedInputConfig.visibleSlots, [
    'referenceImage1',
    'referenceImage2',
    'referenceImage3',
    'referenceImage4',
    'referenceImage5',
    'referenceImage6',
    'referenceImage7',
  ]);
  assert.equal(resolveFixedInputSlotForRef({ fixedInputConfig, kind: 'image', occupiedSlots: refs.map(ref => ref.refSlot) }).slot, 'referenceImage7');
  assert.equal(resolveFixedInputSlotForRef({
    fixedInputConfig,
    kind: 'image',
    occupiedSlots: [...refs.map(ref => ref.refSlot), 'referenceImage7'],
  }).reason, 'overflow');
});