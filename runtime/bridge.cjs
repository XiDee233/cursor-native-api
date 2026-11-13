'use strict';

async function nativeBridge(services, request) {
  const { reactive, storage, settings } = services;
  if (request.action === 'apply' || request.action === 'sync') {
    const catalog = request.catalog;
    const storageKey = 'cursorNativeApiCatalogV2';
    const previous = reactive.applicationUserPersistentStorage[storageKey] || {};
    // Written in one step: clearing first empties the model list and makes Cursor
    // migrate the open conversation back to a default model.
    reactive.setApplicationUserPersistentStorage(storageKey, catalog);
    // Raw provider ids are what the runtime hands back for child runs; keep a
    // reverse map so subagents resolve to the owning service instead of a
    // default model.
    globalThis.__cursorNativeApiNames = Object.fromEntries(Object.entries(catalog).map(([name, model]) => [model.modelId, name]));
    reactive.bumpAvailableModelsCatalogRevision();
    const names = value => Object.keys(value).sort().join('\n');
    if (names(previous) !== names(catalog)) settings.handleAvailableModelsChange();
    reactive.manualSave();
    await storage.flush();
  }
  return { bridge: 28 };
}

module.exports = { nativeBridge };
