export const openaiChatManifest = Object.freeze({
  id: 'openai-compatible-chat',
  name: 'OpenAI Compatible Chat',
  provider: 'openai-compatible',
  type: 'text',
  capabilities: Object.freeze({
    chatCompletion: true,
    streaming: false,
  }),
  inputSchema: Object.freeze({
    prompt: Object.freeze({
      type: 'string',
      required: true,
    }),
    systemPrompt: Object.freeze({
      type: 'string',
      required: false,
    }),
    temperature: Object.freeze({
      type: 'number',
      minimum: 0,
      maximum: 2,
    }),
    maxTokens: Object.freeze({
      type: 'number',
      minimum: 1,
    }),
  }),
  uiSchema: Object.freeze({
    prompt: Object.freeze({
      widget: 'textarea',
      label: 'Prompt',
    }),
    systemPrompt: Object.freeze({
      widget: 'textarea',
      label: 'System Prompt',
    }),
    temperature: Object.freeze({
      widget: 'number',
      label: 'Temperature',
    }),
    maxTokens: Object.freeze({
      widget: 'number',
      label: 'Max Tokens',
    }),
  }),
  defaults: Object.freeze({
    temperature: 0.7,
    maxTokens: 2048,
  }),
});