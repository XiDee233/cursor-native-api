'use strict';

function patchModelPicker(source) {
  source = source.replace(/([\w$]+)\(\(\)=>([\w$]+)\(\)&&([\w$]+)\(\)==="confirmed-free"\)/,
    (all, memo, policy, membership, offset) => {
      const context = source.slice(offset - 2200, offset);
      const services = [...context.matchAll(/([\w$]+)\.reactiveStorageService\.applicationUserPersistentStorage/g)].at(-1)[1];
      return `${memo}(()=>${policy}()&&${membership}()==="confirmed-free"&&Object.keys(${services}.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2??{}).length===0)`;
    });
  const selector = /([\w$]+)=([\w$]+)\(([\w$]+),([\w$]+)=>\(\{useOpenAIKey:\4\.applicationUserPersistentStorage\.useOpenAIKey\?\?!1\}\)\)/;
  source = source.replace(selector, '$1=$2($3,$4=>({useOpenAIKey:$4.applicationUserPersistentStorage.useOpenAIKey??!1,hasConfiguredModels:Object.keys($4.applicationUserPersistentStorage.cursorNativeApiCatalogV2??{}).length>0}))');
  source = source.replace(/const ([\w$]+)=([\w$]+)&&([\w$]+)==="confirmed-free",/,
    (all, flag, policy, membership, offset) => {
      const context = source.slice(offset - 10000, offset);
      const selected = [...context.matchAll(/([\w$]+)=[\w$]+\([\w$]+,[\w$]+=>\(\{useOpenAIKey:/g)].at(-1)[1];
      return `const ${flag}=${policy}&&${membership}==="confirmed-free"&&!${selected}.hasConfiguredModels,`;
    });
  return source;
}

module.exports = { patchModelPicker };
