export const aiComicCharacterCardManifest = Object.freeze({
  id: 'ai-comic-character-card',
  name: 'AI Comic Character Card',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    characterName: Object.freeze({ type: 'string', required: true }),
    role: Object.freeze({ type: 'string', required: false }),
    personality: Object.freeze({ type: 'string', required: false }),
    appearance: Object.freeze({ type: 'string', required: false }),
    outfit: Object.freeze({ type: 'string', required: false }),
    anchorFeatures: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    characterName: Object.freeze({ widget: 'text', label: '角色名' }),
    role: Object.freeze({ widget: 'text', label: '角色定位' }),
    personality: Object.freeze({ widget: 'textarea', label: '性格' }),
    appearance: Object.freeze({ widget: 'textarea', label: '外貌' }),
    outfit: Object.freeze({ widget: 'textarea', label: '服装' }),
    anchorFeatures: Object.freeze({ widget: 'textarea', label: '锚定特征' }),
  }),
  defaults: Object.freeze({
    role: '主角',
    anchorFeatures: '保持发型、脸型、服装主色和标志性配饰一致',
  }),
});