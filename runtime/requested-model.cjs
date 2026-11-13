'use strict';

// Cursor keeps sessions model-agnostic: every turn carries requestedModel, so a
// subagent is only pointed at a service here. Returns the provider model id and
// the credentials for the owning service, or undefined for native models.
function resolveRequestedModel(id, composer, modelDetails, parentModelName) {
  const catalog = globalThis.__cursorNativeApiCatalog;
  const names = globalThis.__cursorNativeApiNames;
  const credentials = globalThis.__cursorNativeApiCredentials;
  let entry = catalog[id] ?? catalog[names[id]];
  if (entry === undefined && id === 'default' && composer?.subagentInfo?.parentComposerId) {
    const parent = parentModelName(composer.subagentInfo.parentComposerId);
    entry = parent === undefined ? undefined : catalog[parent];
  }
  if (entry === undefined) return undefined;
  return {
    modelId: entry.modelId,
    credentials: modelDetails.constructor.fromJson({ apiKeyCredentials: credentials[entry.serviceId] }).credentials
  };
}

module.exports = { resolveRequestedModel };
