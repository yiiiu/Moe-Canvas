export const aiComicVideoPromptManifest = Object.freeze({
  id: 'ai-comic-video-prompt',
  name: 'AI Comic Video Prompt',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    imageDescription: Object.freeze({ type: 'string', required: true }),
    cameraMove: Object.freeze({ type: 'string', required: false }),
    characterAction: Object.freeze({ type: 'string', required: false }),
    duration: Object.freeze({ type: 'string', required: false }),
    motionStrength: Object.freeze({ type: 'string', required: false }),
    style: Object.freeze({ type: 'string', required: false }),
  }),
  uiSchema: Object.freeze({
    imageDescription: Object.freeze({ widget: 'textarea', label: '图像描述' }),
    cameraMove: Object.freeze({ widget: 'text', label: '镜头运动' }),
    characterAction: Object.freeze({ widget: 'textarea', label: '角色动作' }),
    duration: Object.freeze({ widget: 'text', label: '时长' }),
    motionStrength: Object.freeze({ widget: 'text', label: '运动强度' }),
    style: Object.freeze({ widget: 'textarea', label: '风格' }),
  }),
  defaults: Object.freeze({
    cameraMove: '轻微推进',
    duration: '5秒',
    motionStrength: '中等',
    style: '动作自然、角色稳定、适合图生视频',
  }),
});