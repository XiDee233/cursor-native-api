'use strict';

function createCatalog(profiles) {
  const names = profiles.flatMap(profile => Object.keys(profile.modelConfigs));
  return Object.fromEntries(profiles.flatMap(profile => Object.entries(profile.modelConfigs).map(([modelId, config]) => [
    `cursor-native-api:${profile.id}:${encodeURIComponent(modelId)}`,
    {
      serviceId: profile.id, modelId,
      displayName: names.filter(name => name === modelId).length > 1 ? `${config.displayName || modelId} · ${profile.name}` : config.displayName || modelId,
      efforts: config.efforts, defaultEffort: config.defaultEffort,
      contextLength: config.contextLength || 0, maxOutputTokens: config.maxOutputTokens || 0
    }
  ])));
}

module.exports = { createCatalog };
