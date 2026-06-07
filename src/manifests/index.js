import {
  clearCustomProviderRuntimeManifests,
  getCustomProviderRuntimeExecutionManifest,
  getCustomProviderRuntimeManifestBundle,
  getCustomProviderRuntimeModelManifest,
  getCustomProviderRuntimeState,
  listCustomProviderRuntimeExecutionManifests,
  listCustomProviderRuntimeModelManifests,
  resolveCustomProviderRuntimeExecution,
  setCustomProviderRuntimeManifests,
  CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT,
} from './customProviderRuntimeRegistry.js';
import {
  getExecutionManifest as getStaticExecutionManifest,
  getModelManifest as getStaticModelManifest,
  getModelsByKind as getStaticModelsByKind,
  isLocalRuntimeModel as isStaticLocalRuntimeModel,
  isModelApiModel as isStaticModelApiModel,
  isWorkflowModel as isStaticWorkflowModel,
  listModelManifests as listStaticModelManifests,
  normalizeProviderId,
  normalizeUiSchemaFieldValue,
  registerManifestBundle,
  resolveExecutionManifest as resolveStaticExecutionManifest,
  resolveModelExecution as resolveStaticModelExecution,
  resolveModelManifest as resolveStaticModelManifest,
  resolveModelProvider as resolveStaticModelProvider,
  sanitizeModelUiSchemaParams,
  validateExecutionManifest,
  validateModelManifest,
} from './modelRegistry.js';

export {
  clearCustomProviderRuntimeManifests,
  getCustomProviderRuntimeManifestBundle,
  getCustomProviderRuntimeState,
  listCustomProviderRuntimeExecutionManifests,
  listCustomProviderRuntimeModelManifests,
  normalizeProviderId,
  normalizeUiSchemaFieldValue,
  registerManifestBundle,
  sanitizeModelUiSchemaParams,
  setCustomProviderRuntimeManifests,
  CUSTOM_PROVIDER_RUNTIME_CHANGED_EVENT,
  validateExecutionManifest,
  validateModelManifest,
};

function mergeUniqueModelManifests(staticModels, runtimeModels) {
  const merged = new Map();
  for (const model of [...staticModels, ...runtimeModels]) {
    merged.set(model.modelId, model);
  }
  return [...merged.values()];
}

export function getModelManifest(modelId) {
  return (
    getStaticModelManifest(modelId) ||
    getCustomProviderRuntimeModelManifest(modelId) ||
    null
  );
}

export function resolveModelManifest(modelId, providerId = '') {
  return (
    resolveStaticModelManifest(modelId, providerId) ||
    getCustomProviderRuntimeModelManifest(modelId, providerId) ||
    null
  );
}

export function getExecutionManifest(executionId) {
  return (
    getStaticExecutionManifest(executionId) ||
    getCustomProviderRuntimeExecutionManifest(executionId) ||
    null
  );
}

export function resolveExecutionManifest(executionId) {
  return (
    resolveStaticExecutionManifest(executionId) ||
    getCustomProviderRuntimeExecutionManifest(executionId) ||
    null
  );
}

export function resolveModelExecution(modelId, options = {}) {
  return (
    resolveStaticModelExecution(modelId, options) ||
    resolveCustomProviderRuntimeExecution(modelId, options) ||
    null
  );
}

export function resolveModelProvider(
  modelId,
  providerHint = '',
  options = {},
) {
  const staticProvider = resolveStaticModelProvider(modelId, providerHint, options);
  if (staticProvider) {
    return staticProvider;
  }

  const runtimeExecution = resolveCustomProviderRuntimeExecution(modelId, {
    providerHint,
    ...options,
  });
  return runtimeExecution?.modelManifest?.provider || '';
}

export function isModelApiModel(modelId, providerHint = '') {
  return (
    isStaticModelApiModel(modelId, providerHint) ||
    !!resolveCustomProviderRuntimeExecution(modelId, { providerHint })
  );
}

export function isWorkflowModel(modelId, providerHint = '') {
  return isStaticWorkflowModel(modelId, providerHint);
}

export function isLocalRuntimeModel(modelId, providerHint = '') {
  return isStaticLocalRuntimeModel(modelId, providerHint);
}

export function getModelsByKind(kind) {
  return mergeUniqueModelManifests(
    getStaticModelsByKind(kind),
    listCustomProviderRuntimeModelManifests().filter(
      model => !kind || model.kind === String(kind || '').trim(),
    ),
  );
}

export function listModelManifests() {
  return mergeUniqueModelManifests(
    listStaticModelManifests(),
    listCustomProviderRuntimeModelManifests(),
  );
}

export {
  QWEN_IMAGE_EDIT_EXECUTION_ID,
  QWEN_IMAGE_EDIT_MODEL_ID,
  qwenImageEditExecutionManifest,
  qwenImageEditModelManifest,
} from './image/runninghub/qwenImageEditManifest.js';
export {
  ANIME_REAL_EXECUTION_ID,
  ANIME_REAL_MODEL_ID,
  animeRealExecutionManifest,
  animeRealModelManifest,
} from './image/runninghub/animeRealManifest.js';
export {
  PERSON_REPLACE_V21_EXECUTION_ID,
  PERSON_REPLACE_V21_MODEL_ID,
  personReplaceV21ExecutionManifest,
  personReplaceV21ModelManifest,
} from './image/runninghub/personReplaceV21Manifest.js';
export {
  PERSON_REPLACE_V3_EXECUTION_ID,
  PERSON_REPLACE_V3_MODEL_ID,
  personReplaceV3ExecutionManifest,
  personReplaceV3ModelManifest,
} from './image/runninghub/personReplaceV3Manifest.js';
export {
  CONTROL_CAMERA_EXECUTION_ID,
  CONTROL_CAMERA_MODEL_ID,
  controlCameraExecutionManifest,
  controlCameraModelManifest,
} from './image/runninghub/controlCameraManifest.js';
export {
  RH_VIDEO_BASIC_EXECUTION_ID,
  RH_VIDEO_BASIC_MODEL_ID,
  rhVideoBasicExecutionManifest,
  rhVideoBasicModelManifest,
} from './video/runninghub/runningHubVideoBasicManifest.js';
export {
  RH_VIDEO_LTX23_EXECUTION_ID,
  RH_VIDEO_LTX23_MODEL_ID,
  rhVideoLtx23ExecutionManifest,
  rhVideoLtx23ModelManifest,
} from './video/runninghub/runningHubVideoLtx23Manifest.js';
export {
  RH_VIDEO_COMMERCIAL_DIGITAL_HUMAN_EXECUTION_ID,
  RH_VIDEO_COMMERCIAL_DIGITAL_HUMAN_MODEL_ID,
  rhVideoCommercialDigitalHumanExecutionManifest,
  rhVideoCommercialDigitalHumanModelManifest,
} from './video/runninghub/runningHubVideoCommercialDigitalHumanManifest.js';
export {
  RH_VIDEO_LIPSYNC_EXECUTION_ID,
  RH_VIDEO_LIPSYNC_MODEL_ID,
  rhVideoLipSyncExecutionManifest,
  rhVideoLipSyncModelManifest,
} from './video/runninghub/runningHubVideoLipSyncManifest.js';
export {
  RH_VIDEO_V54_EXECUTION_ID,
  RH_VIDEO_V54_MODEL_ID,
  rhVideoV54ExecutionManifest,
  rhVideoV54ModelManifest,
} from './video/runninghub/runningHubVideoV54Manifest.js';
export {
  RH_VIDEO_WATERMARK_REMOVAL_V2_EXECUTION_ID,
  RH_VIDEO_WATERMARK_REMOVAL_V2_MODEL_ID,
  rhVideoWatermarkRemovalV2ExecutionManifest,
  rhVideoWatermarkRemovalV2ModelManifest,
} from './video/runninghub/runningHubVideoWatermarkRemovalV2Manifest.js';
export {
  RH_VIDEO_MATTING_EXECUTION_ID,
  RH_VIDEO_MATTING_KEYING_EXECUTION_ID,
  RH_VIDEO_MATTING_MODEL_ID,
  RH_VIDEO_MATTING_REMOVE_EXECUTION_ID,
  rhVideoMattingExecutionManifest,
  rhVideoMattingModelManifest,
} from './video/runninghub/runningHubVideoMattingManifest.js';
export {
  RH_VIDEO_HD_VIP_EXECUTION_ID,
  RH_VIDEO_HD_VIP_MODEL_ID,
  rhVideoHdVipExecutionManifest,
  rhVideoHdVipModelManifest,
} from './video/runninghub/runningHubVideoHdVipManifest.js';
export {
  RH_VIDEO_FRAME_INTERPOLATION_EXECUTION_ID,
  RH_VIDEO_FRAME_INTERPOLATION_MODEL_ID,
  rhVideoFrameInterpolationExecutionManifest,
  rhVideoFrameInterpolationModelManifest,
} from './video/runninghub/runningHubVideoFrameInterpolationManifest.js';
export {
  DREAMINA_VIDEO_VIP_GATE_ID,
  dreaminaOfficialVideoModelManifest,
  dreaminaVideoExecutionManifest,
  dreaminaVideoExecutionManifests,
  dreaminaVideoModelManifests,
} from './video/dreamina/dreaminaVideoManifest.js';
export {
  RH_AUDIO_INDEXTTS2_CLONE_EXECUTION_ID,
  RH_AUDIO_INDEXTTS2_CLONE_MODEL_ID,
  rhAudioIndexTts2CloneExecutionManifest,
  rhAudioIndexTts2CloneModelManifest,
} from './audio/runninghub/runningHubAudioIndexTts2CloneManifest.js';
export {
  RH_AUDIO_VOICE_CONVERT_EXECUTION_ID,
  RH_AUDIO_VOICE_CONVERT_MODEL_ID,
  rhAudioVoiceConvertExecutionManifest,
  rhAudioVoiceConvertModelManifest,
} from './audio/runninghub/runningHubAudioVoiceConvertManifest.js';
export {
  RH_AUDIO_ADVANCED_VOICE_CLONE_EXECUTION_ID,
  RH_AUDIO_ADVANCED_VOICE_CLONE_MODEL_ID,
  RH_AUDIO_ADVANCED_VOICE_CLONE_RUNNINGHUB_MODEL_ID,
  rhAudioAdvancedVoiceCloneExecutionManifest,
  rhAudioAdvancedVoiceCloneModelManifest,
} from './audio/runninghub/runningHubAudioAdvancedVoiceCloneManifest.js';
export {
  RH_AUDIO_SEPARATION_EXECUTION_ID,
  RH_AUDIO_SEPARATION_MODEL_ID,
  rhAudioSeparationExecutionManifest,
  rhAudioSeparationModelManifest,
} from './audio/runninghub/runningHubAudioSeparationManifest.js';