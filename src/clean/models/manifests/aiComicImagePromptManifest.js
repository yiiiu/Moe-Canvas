export const aiComicImagePromptManifest = Object.freeze({
  id: 'ai-comic-image-prompt',
  name: 'AI Comic Image Prompt',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    scene: Object.freeze({ type: 'string', required: true }),
    characterCard: Object.freeze({ type: 'string', required: false }),
    shotType: Object.freeze({ type: 'string', required: false }),
    emotion: Object.freeze({ type: 'string', required: false }),
    action: Object.freeze({ type: 'string', required: false }),
    aspectRatio: Object.freeze({ type: 'string', required: false }),
    style: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    scene: Object.freeze({ widget: 'textarea', label: '场景' }),
    characterCard: Object.freeze({ widget: 'textarea', label: '角色卡' }),
    shotType: Object.freeze({ widget: 'text', label: '景别' }),
    emotion: Object.freeze({ widget: 'text', label: '情绪' }),
    action: Object.freeze({ widget: 'textarea', label: '动作' }),
    aspectRatio: Object.freeze({ widget: 'text', label: '画幅' }),
    style: Object.freeze({ widget: 'textarea', label: '风格' }),
  }),
  defaults: Object.freeze({
    shotType: '中近景',
    aspectRatio: '9:16',
    style: 'AI 漫剧风格、角色一致、画面干净、可直接用于图像生成',
  }),
});