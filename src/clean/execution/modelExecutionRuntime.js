import { ModelExecutionService } from './modelExecutionService.js';
import { createDefaultModelManifestRegistry } from '../models/modelManifestRegistry.js';
import { createDefaultProviderRegistry } from '../providers/providerRegistry.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createModelExecutionRuntime(options = {}) {
  const {
    manifestRegistry = createDefaultModelManifestRegistry(),
    providerRegistry = createDefaultProviderRegistry(),
    providerConfigResolver,
  } = options;
  const executionService = options.executionService || new ModelExecutionService({
    manifestRegistry,
    providerRegistry,
  });

  return {
    executeModel({ manifestId, input = {}, context = {} } = {}) {
      const baseContext = isObject(context) ? context : {};
      return executionService.execute({
        manifestId,
        input,
        context: {
          ...baseContext,
          providerConfig: providerConfigResolver
            ? providerConfigResolver(manifestId, baseContext)
            : baseContext.providerConfig,
        },
      });
    },

    listModels() {
      return manifestRegistry.listManifests();
    },

    listModelsByProvider(provider) {
      return manifestRegistry.listManifestsByProvider(provider);
    },

    listModelsByType(type) {
      return manifestRegistry.listManifestsByType(type);
    },

    hasModel(id) {
      return manifestRegistry.hasManifest(id);
    },
  };
}