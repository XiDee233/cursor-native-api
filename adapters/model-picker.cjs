'use strict';

function patchModelPicker(source) {
  // Keep Cursor's membership result. Custom choices never unlock additional
  // official models, and the native locked selection cannot replace a custom one.
  const gate = source.match(/const ([\w$]+)=([\w$]+)\(\(\)=>([\w$]+)\(\)&&([\w$]+)\(\)==="confirmed-free"\)/);
  const locked = gate[1];
  const selection = source.match(new RegExp(`([\\w$]+)=([\\w$]+)\\(\\(\\)=>${locked}\\(\\)\\?([\\w$]+)\\(([\\w$]+)\\.reactiveStorageService\\.applicationUserPersistentStorage\\.lockedModelPickerSelection\\):([\\w$]+)\\)`));
  const [, lockedSelection, , resolveLocked, services] = selection;
  const catalog = `${services}.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2??{}`;
  const hasModels = `Object.keys(${catalog}).length>0`;
  const list = /let ([\w$]+)=([\w$]+)\(([\w$]+),([\w$]+),([\w$]+),([\w$]+)\(\)\);return/;
  if ([...source.matchAll(new RegExp(list.source, 'g'))].length !== 1) throw new Error('原生模型菜单列表签名不匹配。');
  source = source.replace(list, (all, rows) => all.replace(';return', `;if(${locked}()&&${hasModels})${rows}=${rows}.filter(model=>model.cursorNativeApi||model.name===${resolveLocked}(${services}.reactiveStorageService.applicationUserPersistentStorage.lockedModelPickerSelection).modelId);return`));
  source = source.replace(new RegExp(`eligible:${locked}\\(\\),onUpgradeClick:`), `eligible:${locked}()&&!(${hasModels}),onUpgradeClick:`);
  const effect = new RegExp(`if\\(!${locked}\\(\\)\\)return;const ([\\w$]+)=${lockedSelection}\\(\\);[\\w$]+\\(\\(\\)=>\\{const ([\\w$]+)=([\\w$]+)\\.composerDataHandle\\(\\),([\\w$]+)=([\\w$]+)\\(\\),`);
  const current = source.match(effect)[5];
  source = source.replace(new RegExp(`if\\(!${locked}\\(\\)\\)return;const ([\\w$]+)=${lockedSelection}\\(\\);`),
    `if(!${locked}()||(${catalog})[${current}()?.selectedModels?.[0]?.modelId??${current}()?.modelName])return;const $1=${lockedSelection}();`);
  return source;
}

module.exports = { patchModelPicker };
