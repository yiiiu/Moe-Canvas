export const aiComicStoryboardManifest = Object.freeze({
  id: 'ai-comic-storyboard',
  name: 'AI Comic Storyboard',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    script: Object.freeze({ type: 'string', required: true }),
    aspectRatio: Object.freeze({ type: 'string', required: false }),
    shotCount: Object.freeze({ type: 'number', required: false, minimum: 1 }),
    visualStyle: Object.freeze({ type: 'string', required: false }),
    characterRefs: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    script: Object.freeze({ widget: 'textarea', label: '脚本' }),
    aspectRatio: Object.freeze({ widget: 'text', label: '画幅' }),
    shotCount: Object.freeze({ widget: 'number', label: '镜头数' }),
    visualStyle: Object.freeze({ widget: 'textarea', label: '视觉风格' }),
    characterRefs: Object.freeze({ widget: 'textarea', label: '角色参考' }),
  }),
  defaults: Object.freeze({
    aspectRatio: '9:16',
    shotCount: 12,
    visualStyle: '漫画感、镜头语言清晰、角色连续性稳定',
  }),
});