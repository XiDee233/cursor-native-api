'use strict';
const { resolveSubagentModel } = require('../runtime/subagent-model.cjs');

function patchModelRouting(source, services) {
  // The official delegate, feature gates and runtime stay untouched. Only a
  // configured catalogue identity selects the native compatibility delegate.
  const router = /this\._delegate=([\w$]+)\.isCursorAgentHostEnabled\(\)\?this\._register\(([\w$]+)\.createInstance\(([\w$]+),void 0\)\):this\._register\(\2\.createInstance\(([\w$]+),void 0\)\),/g;
  if ([...source.matchAll(router)].length !== 1) throw new Error('原生模型执行路由签名不匹配。');
  const original = source;
  const routerIndex = [...source.matchAll(router)][0].index;
  const routerStart = source.lastIndexOf('=class', routerIndex) + 1;
  const routerClass = source.slice(routerStart - 80, routerStart).match(/([\w$]+)=$/)[1];
  const routerEnd = source.indexOf('},' + routerClass + '=', routerIndex) + 1;
  source = source.slice(routerStart, routerEnd);
  source = source.replace(router, (all, gate, factory, host, legacy) =>
    `this._cursorNativeApiServices=${factory}.invokeFunction(a=>({storage:a.get(${services.reactive}),composers:a.get(${services.composers})})),this._cursorNativeApiDelegate=()=>this._cursorNativeApiLegacy??=this._register(${factory}.createInstance(${legacy},void 0)),${all}`);
  const owns = '_cursorNativeApiOwns(options){const s=this._cursorNativeApiServices;const composerId=options.composerId??options.composerHandle?.composerId??options.conversationId;const config=s.composers.getComposerDataIfLoaded(composerId)?.modelConfig;const catalog=s.storage.applicationUserPersistentStorage.cursorNativeApiCatalogV2??{};return [options.requestedModel?.modelId,options.modelDetails?.modelId,options.modelDetails?.modelName,config?.selectedModels?.[0]?.modelId,config?.modelName].some(id=>id!==void 0&&catalog[id]!==void 0)}';
  source = source.replace('_assertAgentAllowed(){', owns + '_assertAgentAllowed(){');
  for (const method of ['runAgentLoop', 'resume', 'summarize']) {
    const signature = new RegExp(`${method}\\(([\\w$]+),([\\w$]+)\\)\\{return this\\._assertAgentAllowed\\(\\),this\\._delegate\\.${method}\\(\\1,\\2\\)\\}`);
    if (!signature.test(source)) throw new Error(`原生 ${method} 路由签名不匹配。`);
    source = source.replace(signature, `${method}($1,$2){if(this._cursorNativeApiOwns($2))return this._cursorNativeApiDelegate().${method}($1,$2);return this._assertAgentAllowed(),this._delegate.${method}($1,$2)}`);
  }
  for (const method of ['prewarmSession', 'prewarmTurn', 'takePrewarmedTurn']) {
    const signature = new RegExp(`${method}\\(([\\w$]+)(,[\\w$]+)?\\)\\{(?=return this\\.|this\\.agentRemoteWorkspacePolicyService)`);
    if (!signature.test(source)) throw new Error(`原生 ${method} 预热签名不匹配。`);
    source = source.replace(signature, `${method}($1$2){if(this._cursorNativeApiOwns({composerId:$1}))return;`);
  }
  source = source.replace(/async seedTurnPrewarm\(([\w$]+),([\w$]+)\)\{/, 'async seedTurnPrewarm($1,$2){if(this._cursorNativeApiOwns({composerId:$1}))return false;');
  for (const method of ['flushTranscriptForConversation', 'noteLocalStop', 'getParentSessionId']) {
    const signature = new RegExp(`${method}\\(([\\w$]+)(,([\\w$]+))?\\)\\{`);
    source = source.replace(signature, (all, id, second = '') => `${all}if(this._cursorNativeApiOwns({composerId:${id}}))return this._cursorNativeApiDelegate().${method}(${id}${second});`);
  }
  source = original.slice(0, routerStart) + source + original.slice(routerEnd);

  // A configured model has its own catalogue even before Cursor's official
  // catalogue arrives. Use the native normalization body in that case too.
  source = source.replace(/fixupModelConfigForCurrentFlag\(([\w$]+)\)\{if\(!\(this\.isPrivateInferenceMode\(\)\?/, 'fixupModelConfigForCurrentFlag($1){if(!((this.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2?.[$1.modelName]!==undefined||this.isPrivateInferenceMode())?');

  // Creation and execution both normalize a subagent request. Cursor rewrites
  // its model config at execution, including resume and continuation turns.
  for (const [method, child] of [['_createOrResumeSubagentSpawn', 'request.resumeAgentId?this._composerDataService.getHandleIfLoaded(request.resumeAgentId)?.data.modelConfig:undefined'], ['_runSubagent', 'handle.data.modelConfig']]) {
    const signature = new RegExp(`async ${method}\\(([\\w$]+),([\\w$]+)(,[\\w$]+)?\\)\\{`);
    if (!signature.test(source)) throw new Error(`原生 ${method} 子代理入口不匹配。`);
    source = source.replace(signature, (all, request, handle) => {
      const childConfig = child.replaceAll('request', request).replaceAll('handle', handle);
      return `${all}${request}=(${resolveSubagentModel.toString()})(${request},this._composerDataService.getHandleIfLoaded(${request}.parentConversationId)?.data.modelConfig,${childConfig},this._modelConfigService.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2??{});`;
    });
  }

  // Request context is built by the composer for custom turns, rather than
  // waiting for an unrelated official inference host to own that context.
  const ownContext = /_isOwnRequestContextEnabled\(\)\{return ([\w$]+)\(this\._cursorAgentHostEnablementService,this\._agentHostProviderService\)\}/;
  if (!ownContext.test(source)) throw new Error('原生请求上下文归属签名不匹配。');
  source = source.replace(ownContext, '_cursorNativeApiOwnsComposer(id){const config=this._composerDataService.getComposerDataIfLoaded(id)?.modelConfig;return this._reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2?.[config?.selectedModels?.[0]?.modelId??config?.modelName]!==undefined}_isOwnRequestContextEnabled(id){return !this._cursorNativeApiOwnsComposer(id)&&$1(this._cursorAgentHostEnablementService,this._agentHostProviderService)}');
  const gather = /([\w$]+)=this\._isOwnRequestContextEnabled\(\),([\w$]+)=([\w$]+)\(this\._composerModesService,this\._composerEffectiveAllowlistService,([\w$]+)\)/;
  const gatherMatch = source.match(gather);
  if (gatherMatch === null) throw new Error('原生请求上下文收集签名不匹配。');
  const gatherId = gatherMatch[4];
  source = source.replace(gather, '$1=this._isOwnRequestContextEnabled($4),$2=$3(this._composerModesService,this._composerEffectiveAllowlistService,$4)');
  const wait = /async _waitForPushRequestContextProviderRegistration\(([\w$]+),([\w$]+)\)\{/;
  source = source.replace(wait, 'async _waitForPushRequestContextProviderRegistration($1,$2,composerId){if(this._cursorNativeApiOwnsComposer(composerId))return;');
  const waitCall = /this\._waitForPushRequestContextProviderRegistration\(([\w$]+),([\w$]+)\),\{enteredAt:Date\.now\(\)\}\)/;
  source = source.replace(waitCall, `this._waitForPushRequestContextProviderRegistration($1,$2,${gatherId}),{enteredAt:Date.now()})`);
  source = source.replace(/prepareAgentRun\(([\w$]+)\)\{const ([\w$]+)=this\._composerDataService\.getComposerDataIfLoaded\(\1\);/, 'prepareAgentRun($1){if(this._cursorNativeApiOwnsComposer($1))return;const $2=this._composerDataService.getComposerDataIfLoaded($1);');

  // Native host sessions keep their tools alive themselves. Compatibility
  // turns retain the native composer leases for running background shells.
  source = source.replace('this._cursorAgentHostEnablementService.isCursorAgentHostEnabled()||(this._register(this._backgroundWorkService.backgroundWorkItems.event(()=>{this._syncBackgroundShellComposerPins()})),this._syncBackgroundShellComposerPins())', '(this._register(this._backgroundWorkService.backgroundWorkItems.event(()=>{this._syncBackgroundShellComposerPins()})),this._syncBackgroundShellComposerPins())');
  source = source.replace(/_syncBackgroundShellComposerPins\(\)\{[\s\S]*?(?=async _retryBackgroundCompletions)/, method => method.replace(/([\w$]+)\.kind==="shell"&&/, '$1.kind==="shell"&&(!this._cursorAgentHostEnablementService.isCursorAgentHostEnabled()||this._cursorNativeApiOwnsComposer($1.composerId)||this._backgroundShellComposerPins.has($1.composerId))&&'));
  const leases = /const ([\w$]+)=new Set\(this\._backgroundWorkService\.getComposerBackgroundWork\(([\w$]+)\)[\s\S]*?\);if\(\1\.size===0\|\|([\w$]+)\.isDisposed\|\|this\._cursorAgentHostEnablementService\.isCursorAgentHostEnabled\(\)\)\{([\w$]+)\.dispose\(\);return\}/;
  source = source.replace(leases, (all, ids, composer, disposables, accessor) => all.replace('this._cursorAgentHostEnablementService.isCursorAgentHostEnabled()', `(this._cursorAgentHostEnablementService.isCursorAgentHostEnabled()&&!${accessor}.cursorNativeApiTools)`));
  source = source.replace(/buildComposerRequestContext\(([\w$]+),([\w$]+),([\w$]+)\)\{[\s\S]*?(?=async _gatherRequestContextWithStaleFallback)/, (method, ctx, composer) => method.replace('if(!this._cursorAgentHostEnablementService.isCursorAgentHostEnabled())', `if(this._cursorNativeApiOwnsComposer(${composer})||!this._cursorAgentHostEnablementService.isCursorAgentHostEnabled())`));
  return source;
}

module.exports = { patchModelRouting };
