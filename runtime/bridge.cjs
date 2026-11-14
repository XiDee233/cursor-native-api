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
    reactive.bumpAvailableModelsCatalogRevision();
    const names = value => Object.keys(value).sort().join('\n');
    if (names(previous) !== names(catalog)) settings._didChangeAvailableModels();
    reactive.manualSave();
    await storage.flush();
  }
  return { bridge: 42 };
}

module.exports = { nativeBridge };
