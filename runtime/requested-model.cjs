'use strict';

// Cursor keeps sessions model-agnostic: every turn carries requestedModel, so a
// subagent is only pointed at a service here. Returns the provider model id and
// the credentials built by Cursor's own credentials constructor.
function resolveRequestedModel(id, composer, parentModelName, buildCredentials) {
  const catalog = globalThis.__cursorNativeApiCatalog;
  const names = globalThis.__cursorNativeApiNames;
  const credentials = globalThis.__cursorNativeApiCredentials;
  if (catalog === undefined || credentials === undefined) return undefined;
  // Only subagent turns are overridden; the main conversation keeps Cursor's own
  // identity so the composer route still owns it.
  if (composer?.subagentInfo?.parentComposerId === undefined) return undefined;
  let entry = catalog[id] ?? catalog[names[id]];
  if (entry === undefined && id === 'default') {
    const parent = parentModelName(composer.subagentInfo.parentComposerId);
    entry = parent === undefined ? undefined : catalog[parent];
  }
  if (entry === undefined) return undefined;
  return { modelId: entry.modelId, credentials: buildCredentials(credentials[entry.serviceId]) };
}

module.exports = { resolveRequestedModel };
