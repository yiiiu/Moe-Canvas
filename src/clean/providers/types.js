export const PROVIDER_KINDS = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
});

export const PROVIDER_CAPABILITIES = Object.freeze({
  CHAT_COMPLETION: 'chatCompletion',
  IMAGE_GENERATION: 'imageGeneration',
  VIDEO_GENERATION: 'videoGeneration',
  AUDIO_GENERATION: 'audioGeneration',
});

export function createProviderResult(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    id: source.id || '',
    provider: source.provider || '',
    model: source.model || '',
    text: source.text || '',
    raw: source.raw ?? null,
    usage: source.usage ?? null,
    finishReason: source.finishReason || '',
  };
}