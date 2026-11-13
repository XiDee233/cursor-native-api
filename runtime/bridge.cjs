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
    // Runtime copies for turn construction: the provider id behind each catalogue
    // name, and the credentials of the owning service. Memory only; SecretStorage
    // remains the single persistent source.
    globalThis.__cursorNativeApiCatalog = catalog;
    globalThis.__cursorNativeApiNames = Object.fromEntries(Object.entries(catalog).map(([name, model]) => [model.modelId, name]));
    globalThis.__cursorNativeApiCredentials = request.credentials;
    reactive.bumpAvailableModelsCatalogRevision();
    const names = value => Object.keys(value).sort().join('\n');
    if (names(previous) !== names(catalog)) settings.handleAvailableModelsChange();
    reactive.manualSave();
    await storage.flush();
  }
  return { bridge: 32 };
}

module.exports = { nativeBridge };
