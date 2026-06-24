export const aiComicDubbingManifest = Object.freeze({
  id: 'ai-comic-dubbing',
  name: 'AI Comic Dubbing',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    script: Object.freeze({ type: 'string', required: true }),
    characterName: Object.freeze({ type: 'string', required: false }),
    voiceStyle: Object.freeze({ type: 'string', required: false }),
    emotion: Object.freeze({ type: 'string', required: false }),
    duration: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    script: Object.freeze({ widget: 'textarea', label: '脚本' }),
    characterName: Object.freeze({ widget: 'text', label: '角色名' }),
    voiceStyle: Object.freeze({ widget: 'textarea', label: '声音风格' }),
    emotion: Object.freeze({ widget: 'text', label: '情绪' }),
    duration: Object.freeze({ widget: 'text', label: '时长' }),
  }),
  defaults: Object.freeze({
    voiceStyle: '短视频旁白，口语化，有情绪起伏',
    emotion: '自然',
    duration: '30秒',
  }),
});