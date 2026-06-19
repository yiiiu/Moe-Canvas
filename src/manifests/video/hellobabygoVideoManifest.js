const HELLOBABYGO_PROVIDER_ID = 'hellobabygo';
const HELLOBABYGO_VIDEO_EXECUTION_ID = 'hellobabygo.video.submit.v1';

function createHellobabyGoVideoResponseMapping() {
  return Object.freeze({
    taskIdPaths: Object.freeze(['task_id', 'id', 'data.task_id', 'data.id']),
    resultPaths: Object.freeze([
      'videoUrl',
      'video_url',
      'url',
      'data.videoUrl',
      'data.video_url',
      'data.url',
      'results[].url',
      'results[].videoUrl',
    ]),
  });
}

function createHellobabyGoAspectRatioField() {
  return Object.freeze({
    id: 'aspectRatio',
    displayRole: 'aspectRatio',
    type: 'segmented',
    placement: 'resolution',
    variant: 'pillMenu',
    label: '比例',
    defaultValue: 'auto',
    options: Object.freeze([
      Object.freeze({ value: 'auto', label: '自适应' }),
      Object.freeze({ value: '16:9', label: '16:9' }),
      Object.freeze({ value: '9:16', label: '9:16' }),
    ]),
  });
}

function createHellobabyGoResolutionField() {
  return Object.freeze({
    id: 'resolution',
    displayRole: 'resolution',
    type: 'segmented',
    placement: 'resolution',
    variant: 'pillMenu',
    label: '视频分辨率',
    defaultValue: '720p',
    options: Object.freeze([
      Object.freeze({ value: '720p', label: '720p' }),
      Object.freeze({ value: '1080p', label: '1080p' }),
      Object.freeze({ value: '4K', label: '4K' }),
    ]),
  });
}

function createHellobabyGoSecondsField({ defaultValue = '8', options = ['8', '10'] } = {}) {
  return Object.freeze({
    id: 'seconds',
    type: 'segmented',
    placement: 'resolution',
    label: '时长',
    defaultValue,
    options: Object.freeze(options.map(value => Object.freeze({ value, label: `${value}秒` }))),
  });
}

function createHellobabyGoVeoDurationField() {
  return Object.freeze({
    id: 'duration',
    type: 'segmented',
    placement: 'resolution',
    label: '时长',
    defaultValue: '8',
    readOnly: true,
    options: Object.freeze([
      Object.freeze({ value: '8', label: '8s' }),
    ]),
  });
}

function createHellobabyGoVeoModeField() {
  return Object.freeze({
    id: 'mode',
    type: 'segmented',
    placement: 'mode',
    variant: 'sectionMenu',
    label: '模型选择',
    defaultValue: 'fast',
    options: Object.freeze([
      Object.freeze({ value: 'fast', label: 'fast' }),
    ]),
  });
}

function createHellobabyGoVeoGenerationTypeField() {
  return Object.freeze({
    id: 'generation_type',
    type: 'segmented',
    placement: 'mode',
    variant: 'sectionMenu',
    label: '模式选择',
    defaultValue: 'text',
    options: Object.freeze([
      Object.freeze({ value: 'text', label: '文生视频' }),
      Object.freeze({ value: 'text_hd', label: '高清' }),
      Object.freeze({ value: 'frame', label: '首尾帧' }),
      Object.freeze({ value: 'reference', label: '参考图' }),
    ]),
  });
}

function createHellobabyGoVideoInputSlots() {
  return Object.freeze({
    fixedSlots: Object.freeze([
      Object.freeze({ id: 'referenceImages', kind: 'image', required: false }),
    ]),
    minByKind: Object.freeze({ image: 0 }),
  });
}

function createHellobabyGoReferenceImageSlots(count, { showWhenFactory = undefined, firstRequired = false } = {}) {
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const showWhen = typeof showWhenFactory === 'function' ? showWhenFactory() : undefined;
    const slot = {
      id: `referenceImage${index + 1}`,
      kind: 'image',
      label: `参考图 ${index + 1}`,
      ...(firstRequired && index === 0 ? { required: true } : {}),
      ...(showWhen ? { showWhen } : {}),
    };
    return Object.freeze(slot);
  }));
}

function createHellobabyGoVeoReferenceImageSlots() {
  return createHellobabyGoReferenceImageSlots(3, {
    showWhenFactory: () => Object.freeze({ field: 'generation_type', value: 'reference' }),
  });
}

function createHellobabyGoOmniReferenceImageSlots() {
  return createHellobabyGoReferenceImageSlots(7, { firstRequired: true });
}

function createHellobabyGoVeoInputSlots() {
  return Object.freeze({
    allowedKinds: Object.freeze(['text', 'image']),
    fixedSlots: Object.freeze([
      Object.freeze({ id: 'firstFrame', kind: 'image', label: '首帧图', showWhen: Object.freeze({ field: 'generation_type', value: 'frame' }) }),
      Object.freeze({ id: 'lastFrame', kind: 'image', label: '尾帧图', showWhen: Object.freeze({ field: 'generation_type', value: 'frame' }) }),
      ...createHellobabyGoVeoReferenceImageSlots(),
    ]),
    minByKind: Object.freeze({ image: 0 }),
    maxByKind: Object.freeze({ image: 3 }),
  });
}

function createHellobabyGoOmniInputSlots() {
  return Object.freeze({
    allowedKinds: Object.freeze(['text', 'image']),
    fixedSlots: createHellobabyGoOmniReferenceImageSlots(),
    minByKind: Object.freeze({ image: 1 }),
    maxByKind: Object.freeze({ image: 7 }),
  });
}

function createHellobabyGoVideoExecutionManifest() {
  const responseMapping = createHellobabyGoVideoResponseMapping();

  return Object.freeze({
    schemaVersion: '1.0',
    id: HELLOBABYGO_VIDEO_EXECUTION_ID,
    provider: HELLOBABYGO_PROVIDER_ID,
    kind: 'video',
    adapterType: 'modelApi',
    endpoint: '/v1/videos',
    method: 'POST',
    model: 'grok-imagine-video-1.5-preview',
    headers: Object.freeze({ 'Content-Type': 'application/json' }),
    bodyMapping: Object.freeze({
      entries: Object.freeze([
        Object.freeze({
          path: 'model',
          from: 'payload',
          fields: Object.freeze(['model']),
          defaultValue: 'grok-imagine-video-1.5-preview',
          transform: 'hellobabygoVideoModel',
        }),
        Object.freeze({ path: 'prompt', from: 'prompt' }),
        Object.freeze({
          path: 'size',
          from: 'payload',
          fields: Object.freeze(['generationParams.aspectRatio', 'aspectRatio']),
          defaultValue: '1:1',
          transform: 'hellobabygoVideoSize',
        }),
        Object.freeze({
          path: 'seconds',
          from: 'payload',
          fields: Object.freeze(['generationParams.seconds', 'seconds']),
          defaultValue: '10',
          transform: 'hellobabygoVideoSeconds',
          omitWhenEmpty: true,
        }),
        Object.freeze({
          path: 'duration',
          from: 'payload',
          fields: Object.freeze(['generationParams.duration', 'duration']),
          defaultValue: '8',
          transform: 'hellobabygoVideoDuration',
          omitWhenEmpty: true,
        }),
        Object.freeze({
          path: 'input_reference',
          from: 'inputImages',
          transform: 'hellobabygoVideoInputReference',
          omitWhenEmpty: true,
          when: Object.freeze([
            Object.freeze({ field: 'model', notEquals: 'hellobabygo/omni_flash' }),
            Object.freeze({ field: 'generationParams.generation_type', notEquals: 'frame' }),
          ]),
        }),
        Object.freeze({
          path: 'reference_images',
          from: 'inputImages',
          omitWhenEmpty: true,
          when: Object.freeze({ field: 'generationParams.generation_type', equals: 'frame' }),
        }),
        Object.freeze({
          path: 'reference_images',
          from: 'inputImages',
          omitWhenEmpty: true,
          when: Object.freeze({ field: 'model', equals: 'hellobabygo/omni_flash' }),
        }),
        Object.freeze({
          path: 'reference_mode',
          from: 'constant',
          value: 'image',
          when: Object.freeze({ field: 'generationParams.generation_type', equals: 'frame' }),
        }),
        Object.freeze({
          path: 'reference_mode',
          from: 'constant',
          value: 'image',
          when: Object.freeze({ field: 'model', equals: 'hellobabygo/omni_flash' }),
        }),
      ]),
    }),
    responseMapping,
    result: Object.freeze({
      type: 'video',
      resultPaths: Object.freeze([
        'videoUrl',
        'video_url',
        'url',
        'data.videoUrl',
        'data.video_url',
        'data.url',
        'results[].url',
        'results[].videoUrl',
      ]),
    }),
    extensions: Object.freeze({
      source: 'builtin',
      provider: HELLOBABYGO_PROVIDER_ID,
      taskPolling: Object.freeze({ urlTemplate: '{baseUrl}/v1/videos/{taskId}' }),
    }),
  });
}

function createHellobabyGoVideoModelManifest({
  modelId,
  displayName,
  aliases = [],
  secondsField = createHellobabyGoSecondsField(),
  inputSlots = createHellobabyGoVideoInputSlots(),
  uiFields = [createHellobabyGoAspectRatioField(), createHellobabyGoResolutionField(), secondsField],
  footerPlacementOrder = undefined,
}) {
  return Object.freeze({
    schemaVersion: '1.0',
    modelId,
    aliases: Object.freeze(aliases),
    provider: HELLOBABYGO_PROVIDER_ID,
    kind: 'video',
    adapterType: 'modelApi',
    executionId: HELLOBABYGO_VIDEO_EXECUTION_ID,
    displayName,
    icon: null,
    description: '斑点蛙视频生成，提交到 /v1/videos，按 task_id 轮询。',
    inputSlots,
    uiSchema: Object.freeze({
      fields: Object.freeze(uiFields),
      ...(Array.isArray(footerPlacementOrder) ? { footerPlacementOrder: Object.freeze(footerPlacementOrder) } : {}),
    }),
    async: true,
    cancellable: true,
    outputType: 'video',
    source: 'builtin',
    extensions: Object.freeze({ source: 'builtin', provider: HELLOBABYGO_PROVIDER_ID }),
  });
}

export const hellobabyGoVideoExecutionManifests = Object.freeze([
  createHellobabyGoVideoExecutionManifest(),
]);

const HELLOBABYGO_GROK_SECONDS_FIELD = createHellobabyGoSecondsField({
  defaultValue: '10',
  options: ['10', '15'],
});

export const hellobabyGoVideoModelManifests = Object.freeze([
  createHellobabyGoVideoModelManifest({
    modelId: 'hellobabygo/grok-imagine-video-1.5-preview',
    displayName: '斑点蛙 Grok Imagine Video 1.5 Preview',
    aliases: Object.freeze(['grok-imagine-video-1.5-preview']),
    secondsField: HELLOBABYGO_GROK_SECONDS_FIELD,
  }),
  createHellobabyGoVideoModelManifest({
    modelId: 'hellobabygo/omni_flash',
    displayName: '斑点蛙 Omni Flash',
    aliases: Object.freeze(['omni_flash']),
    secondsField: createHellobabyGoSecondsField({
      defaultValue: '10',
      options: ['10', '15'],
    }),
    inputSlots: createHellobabyGoOmniInputSlots(),
  }),
  createHellobabyGoVideoModelManifest({
    modelId: 'hellobabygo/veo_3_1-fast-landscape',
    displayName: '斑点蛙 VEO 3.1',
    aliases: Object.freeze([
      'veo_3_1-fast-landscape',
      'veo_3_1-fast-portrait',
      'veo_3_1-fast-landscape-fl',
      'veo_3_1-fast-portrait-fl',
      'veo_3_1-fast-landscape-hd',
      'veo_3_1-fast-portrait-hd',
      'veo_3_1-fast-landscape-fl-hd',
      'veo_3_1-fast-portrait-fl-hd',
      'hellobabygo/veo_3_1-fast-portrait',
      'hellobabygo/veo_3_1-fast-landscape-fl',
      'hellobabygo/veo_3_1-fast-portrait-fl',
      'hellobabygo/veo_3_1-fast-landscape-hd',
      'hellobabygo/veo_3_1-fast-portrait-hd',
      'hellobabygo/veo_3_1-fast-landscape-fl-hd',
      'hellobabygo/veo_3_1-fast-portrait-fl-hd',
    ]),
    secondsField: createHellobabyGoVeoDurationField(),
    inputSlots: createHellobabyGoVeoInputSlots(),
    uiFields: [
      createHellobabyGoVeoModeField(),
      createHellobabyGoVeoGenerationTypeField(),
      createHellobabyGoAspectRatioField(),
      createHellobabyGoResolutionField(),
      createHellobabyGoVeoDurationField(),
    ],
    footerPlacementOrder: ['mode', 'resolution'],
  }),
]);