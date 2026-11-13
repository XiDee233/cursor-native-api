'use strict';
const { nativeBridge } = require('../runtime/bridge.cjs');
const { enrichModel } = require('../runtime/model.cjs');
const { resolveRequestedModel } = require('../runtime/requested-model.cjs');
const { patchModelCapabilities } = require('./model-capabilities.cjs');
const { patchModelPicker } = require('./model-picker.cjs');
const { showConfigPanel } = require('../runtime/config-panel.cjs');
const { connectConversationActions } = require('../runtime/conversation-actions.cjs');
const { resolveConversationActions, patchSdkConversationActions } = require('./conversation-actions.cjs');

const fs = require('node:fs');
const path = require('node:path');
const SDK = 'extensions/cursor-agent-exec/dist/main.js';
const HOST = 'extensions/cursor-agent-host/dist/main.js';
const DEDICATED = 'extensions/cursor-local-agent-runtime/dist/main.js';
const SDK_FILES = [SDK, HOST, DEDICATED];
const SDK_ANCHOR = 'function(e,t,r,n,s,o=!1,i){const a=function(e){const t=e?.find((e=>["reasoning","effort","thought_level"].includes(e.id)))?.value;';
const WORKBENCH = [
  /prepareAgentRun\(\)\{[\w$]+\.localMode\|\|/g,
  /isSteeringAvailable\(\)\{/g,
  /isSteeringFeatureEnabled\(\)\{/g,
  /original:"Configure Local Agent"\}\}\)\}async run\([\w$]+,\.\.\.[\w$]+\)\{if\(![\w$]+\.localMode\)return;[\w$]+\.get\([\w$]+\)\.showLocalAgentConfigurationModal\(\)/g,
  /children:"Configure gateway"/g,
  /getAvailableDefaultModels\(\)\{return\[\.\.\.this\._availableDefaultModels\(\)\]\}/g,
  /=\["anysphere.cursor-resolver","anysphere.cursor-always-local","anysphere.cursor-agent-worker"/g
];

const testedVersions = ['3.30.8'];
const OFF = 'cursorPredictionOptions:!1,localMode:!1,restoresStoredServer:!1,orbitBuild:!1';
const ON = 'cursorPredictionOptions:!1,localMode:!0,restoresStoredServer:!1,orbitBuild:!1';
const BUNDLES = [
  'out/main.js', 'out/cli.js',
  'out/vs/workbench/workbench.desktop.main.js',
  'out/vs/workbench/workbench.glass.main.js',
  'out/vs/code/electron-utility/sharedProcess/sharedProcessMain.js',
  'out/vs/code/node/cliProcessMain.js',
  'out/vs/workbench/api/worker/extensionHostWorkerMain.js',
  'out/vs/code/electron-utility/mcpProcess/mcpProcessMain.js',
  'out/vs/workbench/api/node/extensionHostProcess.js',
  'out/vs/platform/terminal/node/ptyHostMain.js'
];

function patchSdk(source, relative, actions) {
  if (relative === HOST) {
    // Agent Host owns activation, MCP wiring and disposal of the shared runtime.
    const route = /const ([\w$]+)=([\w$]+)\|\|([\w$]+),([\w$]+)=\(([\w$]+)=\{gate:/g;
    if ([...source.matchAll(route)].length !== 1) throw new Error('原生共享执行服务签名不匹配。');
    return source.replace(route, 'const $1=!1,$4=($5={gate:');
  }
  source = patchModelCapabilities(source);
  if (relative === SDK) {
    const provider = /([\w$]+)\(([\w$]+),([\w$]+),\{factory:([\w$]+),teamSettingsService:/g;
    if ([...source.matchAll(provider)].length !== 1) throw new Error('原生执行服务注册签名不匹配。');
    // Share the native tool factory without registering canvas twice.
    source = source.replace(provider, '$1($2,{...$3,registerAgentExecProvider:!0},{factory:$4,teamSettingsService:');
    source = source.replace('return e.localLoopEnabled&&!e.moveExecEnabled', 'return!1');
  }
  return patchSdkConversationActions(source, actions[relative]);
}

function patchExtensionHost(source) {
  return source.replace(/reportGatewayRequest:([\w$]+)=>this\._proxy\.\$localAgentReportGatewayRequest\(([\w$]+),\1\),/g,
    'conversationAction:async operation=>{const result=await this._proxy.$localAgentConversationAction($2,operation);return operation==="next"?result.buffer:undefined},$&');
}

function patchWorkbench(source, relative) {
  const service = name => {
    const index = source.indexOf('("'+name+'")');
    return source.slice(index-120,index).match(/([\w$]+)=[\w$]+$/)[1];
  };
  const pattern = /(original:"Configure Local Agent"\}\}\)\}async run\()([\w$]+),\.\.\.([\w$]+)(\)\{if\(![\w$]+\.localMode\)return;)([\w$]+\.get\([\w$]+\)\.showLocalAgentConfigurationModal\(\))/g;
  if ([...source.matchAll(pattern)].length !== 1) throw new Error('原生 API 配置命令签名不匹配。');
  const commandService = service('commandService');
  const agentClientService = service('agentClientService');
  source = source.replace('=["anysphere.cursor-resolver","anysphere.cursor-always-local","anysphere.cursor-agent-worker"', '=["local-tools.cursor-native-api","anysphere.cursor-resolver","anysphere.cursor-always-local","anysphere.cursor-agent-worker"');
  source = source.replace(/async executeTurn\(([\w$]+)\)\{const ([\w$]+)=\1\.conversationId;this\._rootSessionMirror/, (all, turn, conversation) => {
    const call = ['ctx', 'conversationState', 'action', 'modelDetails', 'interactionListener', 'resourceAccessor', 'blobStore', 'conversationActionManager', 'checkpointHandler', 'mcpTools', 'runOptions'].map(field => `${turn}.${field}`).join(',');
    return `async executeTurn(${turn}){const customModelName=${turn}.runOptions.requestedModel?.modelId??${turn}.modelDetails?.modelId;if(customModelName?.startsWith("cursor-native-api:")||globalThis.__cursorNativeApiNames?.[customModelName])return this._instantiationService.invokeFunction(accessor=>accessor.get(${agentClientService})).run(${call});const ${conversation}=${turn}.conversationId;this._rootSessionMirror`;
  });
  const names = { ai: service('aiService'), auth: service('authenticationService'), reactive: service('reactiveStorageService'), storage: service('storageService'), models: service('modelConfigService'), settings: service('AISettingsService') };
  source = source.replace(pattern, (all, start, accessor, args, condition, show) => {
    const deps = Object.entries(names).map(([key, id]) => `${key}:${accessor}.get(${id})`).join(',');
    return `${start}${accessor},...${args}){if(${args}[0]?.__cursorNativeApi===2)return await (${nativeBridge.toString()})({${deps}},${args}[0]);return ${accessor}.get(${commandService}).executeCommand("cursorNativeApi.settings")`;
  });
  const gatewayLabel = source.indexOf('children:"Configure gateway"');
  const gatewayStart = source.lastIndexOf('function ', gatewayLabel);
  const gatewayEnd = source.indexOf('function ', gatewayLabel);
  const gateway = source.slice(gatewayStart, gatewayEnd);
  const component = gateway.match(/^function ([\w$]+)\(/)[1];
  const clickVar = gateway.match(/onClick:\(\)=>\s*([\w$]+)\.showLocalAgentConfigurationModal\(\)/)[1];
  const serviceHook = gateway.match(new RegExp(`${clickVar}=([\\w$]+)\\(([\\w$]+)\\)`))[1];
  const [, render, entry] = gateway.match(/([\w$]+)\(([\w$]+)\.Entry/);
  const button = gateway.match(/children:[\w$]+\(([\w$]+),\{onClick:/)[1];
  const replacement = 'function '+component+'(){const commands='+serviceHook+'('+commandService+');return '+render+'('+entry+'.Root,{accessibleLabel:"模型服务",children:'+render+'('+entry+'.Entry,{label:"模型服务",children:'+render+'('+button+',{onClick:()=>commands.executeCommand("cursorNativeApi.settings"),size:"sm",variant:"secondary",children:"配置模型服务"})})})}';
  source = source.slice(0, gatewayStart) + replacement + source.slice(gatewayEnd);
  source = patchModelPicker(source);
  const catalogRead = 'getAvailableDefaultModels(){return[...this._availableDefaultModels()]}';
  source = source.replace(catalogRead, 'getAvailableDefaultModels(){const configured=this.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2||{};return [...this._availableDefaultModels(),...Object.entries(configured).map(([name,config])=>(' + enrichModel.toString() + ')({name,serverModelName:name,supportsAgent:true,defaultOn:true},config))]}');
  source = source.replace(/(getAllPotentialModelsReactiveWithStatus\(\)\.filter\([\w$]+\))/, '$1.filter(model=>!model.name.startsWith("cursor-native-api:"))');
  // A turn's requestedModel is the only place Cursor crosses from model identity to
  // the provider call, so subagent inheritance and credentials are resolved here.
  const signature = source.match(/function ([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{const ([\w$]+)=\2\.composerDataService\.getComposerData\(/);
  if (signature === null) throw new Error('原生请求模型构建签名不匹配。');
  const [, , services, details, , composer] = signature;
  const requestLog = /;return ([\w$]+)\.logService\.info\("\[buildRequestedModel\]"/;
  if (!requestLog.test(source)) throw new Error('原生请求模型日志签名不匹配。');
  source = source.replace(requestLog, `,customRequest=(${resolveRequestedModel.toString()})(d,${composer},pid=>{const parent=${services}.composerDataService.allComposersData.allComposers?.find(item=>item.composerId===pid);return parent?.modelConfig?.modelName;},value=>uEp({apiKey:value.apiKey,openaiApiBaseUrl:value.baseUrl}));return $1.logService.info("[buildRequestedModel]"`);
  source = source.replace(/new ([\w$]+)\(\{modelId:d,maxMode:u,/, 'new $1({modelId:customRequest?customRequest.modelId:d,maxMode:u,');
  source = source.replace(new RegExp(`,credentials:([\\w$]+)\\(${details}\\)\\}`), `,credentials:customRequest?customRequest.credentials:$1(${details})}`);
  source = source.replace(/async runLocalAgentInExtensionHost\([^)]*\)\{[\s\S]*?(?=async prewarm\(\))/, method => {
    const catalog = 'this.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2';
    const args = method.match(/^async runLocalAgentInExtensionHost\(([^)]*)\)/)[1].split(',');
    const [ctx, , , modelDetails, , blobs, , , resources, options] = args;
    const streamFactory = source.match(/resetStream\(\)\{if\(this\.disposed\)throw new [\w$]+\("ControlledConversationActionManager disposed"\);this\.acceptsActions=!1,this\.clientStream\.close\(\),this\.clientStream=([\w$]+)\(\)/)[1];
    const prepare = source.match(/await ([\w$]+)\(\{ctx:[\w$]+,action:[\w$]+,resources:[\w$]+,blobStore:[\w$]+,options:[\w$]+,source:"queued_action"\}/)[1];
    const buffer = method.match(/defaultModel:([\w$]+)\.wrap\(/)[1];
    method = method.replace('){', ',configuredRuntime,conversationActionManager){');
    method = method.replace('){', `){if(configuredRuntime){const credentials=globalThis.__cursorNativeApiCredentials[configuredRuntime.serviceId];${modelDetails}=${modelDetails}?${modelDetails}.constructor.fromBinary(${modelDetails}.toBinary()):this.createDefaultLocalModel(${options});${modelDetails}.modelId=configuredRuntime.modelId;${modelDetails}.credentials=${modelDetails}.constructor.fromJson({apiKeyCredentials:credentials}).credentials;if(${options}.requestedModel)${options}.requestedModel.credentials=${modelDetails}.credentials;}`);
    method = method.replace(/customHeaders:([\w$]+)\.customHeaders,/, (all, provider) => `customHeaders:configuredRuntime?{...${provider}.customHeaders,...(/^https:\\/\\/(?:[^/]+\\.)?opencode\\.ai\\//.test(${provider}.baseUrl)?{"x-opencode-session":${options}.conversationId}:{})}:${provider}.customHeaders,`);
    method = method.replace('this.logService.info(', `const configuredCatalog=configuredRuntime?Object.values(${catalog}).filter(model=>model.serviceId===configuredRuntime.serviceId):[];this.logService.info(`);
    method = method.replace('try{const ', `const conversationAction=configuredRuntime?(${connectConversationActions.toString()})(conversationActionManager,${ctx},${streamFactory}(),async action=>{await ${prepare}({ctx:${ctx},action,resources:${resources},blobStore:${blobs},options:${options},source:"queued_action"});return ${buffer}.wrap(action.toBinary())}):undefined;try{const `);
    method = method.replace('runOptions:{', 'runOptions:{cursorNativeApiActions:!!configuredRuntime,');
    method = method.replace(/=\{sendInteractionUpdate:/, `={conversationAction:async operation=>{const result=await conversationAction(operation);return operation==="next"?(result.done?${buffer}.wrap(new Uint8Array(0)):result.value):undefined},sendInteractionUpdate:`);
    method = method.replace(/\}\}$/, '}finally{if(configuredRuntime)await conversationAction("close")}}');
    method = method.replace(/availableModelIds:([\w$]+),/, 'availableModelIds:configuredRuntime?configuredCatalog.map(model=>model.modelId):$1,');
    method = method.replace(/providerModelCatalog:([\w$]+\(this\.storageService,[\w$]+\.baseUrl\))/, 'providerModelCatalog:configuredRuntime?configuredCatalog.map(model=>({id:model.modelId,api_types:["chat_completions"],capabilities:{reasoning_effort:model.efforts.map(option=>option.value),...(model.contextLength>0?{context_length:model.contextLength}:{}),...(model.maxOutputTokens>0?{max_output_tokens:model.maxOutputTokens}:{})}})):$1');
    return method;
  });
  source = source.replace(/async \$localAgentReportGatewayRequest\(([\w$]+),([\w$]+)\)\{/, 'async $localAgentConversationAction(run,operation){return this._getLocalRunCallbacks(run).conversationAction(operation)}$&');
  const localCall = source.match(/return this\.runLocalAgentInExtensionHost\(([^)]+)\)/)[1];
  const localModel = localCall.split(',')[3];
  const actionManager = source.slice(source.lastIndexOf('async run(', source.indexOf('return this.runLocalAgentInExtensionHost(')), source.indexOf('return this.runLocalAgentInExtensionHost(')).match(/^async run\(([^)]*)\)/)[1].split(',')[7];
  source = source.replace(/if\(([\w$]+)\.releaseAfterSend\(([\w$]+)\.conversationId\),([\w$]+)\.localMode\)\{try\{([\w$]+)\.onNetworkPhaseStart/, (all, release, options, flags, normalized) => {
    return `const custom=(()=>{const catalog=this.reactiveStorageService.applicationUserPersistentStorage.cursorNativeApiCatalogV2||{};const modelName=${options}.requestedModel?.modelId??${localModel}?.modelId;return catalog[modelName]??catalog[globalThis.__cursorNativeApiNames?.[modelName]];})();if(${release}.releaseAfterSend(${options}.conversationId),${flags}.localMode||custom){if(custom&&${normalized}.requestedModel){${normalized}.requestedModel=${normalized}.requestedModel.constructor.fromBinary(${normalized}.requestedModel.toBinary());${normalized}.requestedModel.modelId=custom.modelId;}try{${normalized}.onNetworkPhaseStart`;
  });
  source = source.replace(/return this\.runLocalAgentInExtensionHost\(([^)]+)\)/, (all, args) => {
    const model = args.split(',')[3];
    return `if(custom&&${model}){${model}=${model}.constructor.fromBinary(${model}.toBinary());${model}.modelId=custom.modelId;}return this.runLocalAgentInExtensionHost(${args},custom,${actionManager})`;
  });
  if (relative.endsWith('workbench.glass.main.js')) {
    source = source.replace('return this._editorService.openEditor(o,{pinned:!0,preserveFocus:r.preserveFocus,', `if(t.providedViewType==="cursorNativeApi.config"){(${showConfigPanel.toString()})(o,document.defaultView);return o}return this._editorService.openEditor(o,{pinned:!0,preserveFocus:r.preserveFocus,`);
    source = source.replace('revealWebview(t,e,n){', 'revealWebview(t,e,n){if(t.webview.providedViewType==="cursorNativeApi.config")return t.cursorNativeApiPanel.reveal();');
  }
  return source;
}
function matches(root, appRoot = root) {
  const files = [...BUNDLES, ...SDK_FILES];
  if (!files.every(file => fs.existsSync(path.join(root, file)) || fs.existsSync(path.join(appRoot, file)))) return false;
  const sources = BUNDLES.map(file => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
  const sdk = fs.readFileSync(path.join(root, SDK), 'utf8');
  return sources.every(({ text }) => text.split(OFF).length === 2 && !text.includes(ON))
    && sources.filter(({ file }) => /workbench\.(desktop|glass)\.main\.js$/.test(file)).every(({ text }) => WORKBENCH.every(rule => [...text.matchAll(rule)].length === 1) && ['commandService', 'aiService', 'authenticationService', 'reactiveStorageService', 'storageService', 'modelConfigService', 'AISettingsService'].every(name => text.split('("'+name+'")').length === 2))
    && sdk.split(SDK_ANCHOR).length === 2
    && [...sdk.matchAll(/([\w$]+)\(([\w$]+),([\w$]+),\{factory:([\w$]+),teamSettingsService:/g)].length === 1
    && sdk.split('return e.localLoopEnabled&&!e.moveExecEnabled').length === 2;
}
function resolveRuntimeActions(sourceRoot, appRoot, relative) {
  if (!relative) return Object.fromEntries([SDK, DEDICATED].map(name => [name, resolveConversationActions(sourceRoot, appRoot, name)]));
  if (![SDK, DEDICATED].includes(relative)) return undefined;
  return resolveConversationActions(sourceRoot, appRoot, relative);
}
module.exports = { testedVersions, SDK, SDK_FILES, OFF, ON, BUNDLES, patchSdk, patchWorkbench, patchExtensionHost, resolveConversationActions: resolveRuntimeActions, matches };
