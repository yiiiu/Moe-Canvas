export const aiComicScriptManifest = Object.freeze({
  id: 'ai-comic-script',
  name: 'AI Comic Script',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    theme: Object.freeze({ type: 'string', required: true }),
    genre: Object.freeze({ type: 'string', required: false }),
    duration: Object.freeze({ type: 'string', required: false }),
    episodeCount: Object.freeze({ type: 'number', required: false, minimum: 1 }),
    characters: Object.freeze({ type: 'string', required: false }),
    style: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    theme: Object.freeze({ widget: 'textarea', label: '主题' }),
    genre: Object.freeze({ widget: 'text', label: '类型' }),
    duration: Object.freeze({ widget: 'text', label: '时长' }),
    episodeCount: Object.freeze({ widget: 'number', label: '集数' }),
    characters: Object.freeze({ widget: 'textarea', label: '角色' }),
    style: Object.freeze({ widget: 'textarea', label: '风格' }),
  }),
  defaults: Object.freeze({
    genre: '竖屏短剧',
    duration: '60秒',
    episodeCount: 1,
    style: '节奏紧凑、强钩子、适合 AI 漫剧分镜',
  }),
});