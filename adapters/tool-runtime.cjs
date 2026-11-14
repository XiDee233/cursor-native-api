'use strict';
const { createToolProvider } = require('../runtime/tool-provider.cjs');

const SCOPE = 'cursor-native-api';

function patchToolWorkbench(source, services) {
  const observable = source.match(/this\._handlerRegistry=new [\w$]+,this\._localAgentRuntimeHandler=new ([\w$]+)/)[1];
  source = source.replace(/registerLocalAgentRuntimeHandler\(([\w$]+)\)\{/, `registerNativeApiExecHandler(handler){return(this._cursorNativeApiExecHandler??=new ${observable}).set(handler)}registerLocalAgentRuntimeHandler($1){`);
  source = source.replace(/createRemoteAccessor\(([^)]*)\)\{const ([\w$]+)=/, `createRemoteAccessor($1,cursorNativeApi){const $2=cursorNativeApi&&this.instantiationService.invokeFunction(accessor=>accessor.get(${services.enablement}).isCursorAgentHostEnabled())?(this._cursorNativeApiExecHandler??=new ${observable}):`);
  source = source.replace(/(,[\w$]+\.authority)\)(,[\w$]+=[\w$]+\(([\w$]+),[\w$]+,this\._instantiationService,this\._gitContextService)/, '$1,this._cursorNativeApiOwnsComposer($3))$2');
  source = source.replace(/this\._setResourceAccessor\(([\w$]+),([\w$]+)\),this\.runIdleHooks\(\1\)/, '$2.cursorNativeApiTools=this._cursorNativeApiOwnsComposer($1),this._setResourceAccessor($1,$2),this.runIdleHooks($1)');

  source = source.replace(/\$registerAgentExecProvider\(\)\{const ([\w$]+)=this\.agentExecProviderService\.registerHandler\(/,
    `$registerAgentExecProvider(scope){const $1=this.agentExecProviderService[scope==="${SCOPE}"?"registerNativeApiExecHandler":"registerHandler"](`);
  source = source.replace(/this\._proxy\.\$initializeAgentExecSession\(([\w$]+),([\w$]+)\)/, 'this._proxy.$initializeAgentExecSession($1,$2,scope)');
  source = source.replace(/this\._agentExecProviderHandleDisposable\.value=([\w$]+)\}async \$registerLocalAgentRuntimeProvider/,
    `if(scope==="${SCOPE}")this._cursorNativeApiExecRegistration=$1;else this._agentExecProviderHandleDisposable.value=$1}async $registerLocalAgentRuntimeProvider`);
  source = source.replace('async $unregisterAgentExecProvider(){', `async $unregisterAgentExecProvider(scope){if(scope==="${SCOPE}"){this._cursorNativeApiExecRegistration.dispose();return}`);
  return source;
}

function patchToolExtensionHost(source) {
  source = source.replace(/registerAgentExecProvider\(([\w$]+)\)\{return ([\w$]+)\.registerAgentExecProvider\(\1\)\}/,
    'registerAgentExecProvider($1,scope){return $2.registerAgentExecProvider($1,scope)}');
  const register = /registerAgentExecProvider\(([\w$]+)\)\{return this\._agentExecProviderOv\.set\(\1\),/;
  const disposable = source.slice(source.search(register)).match(/,([\w$]+)\(\(\)=>/)[1];
  source = source.replace(register, (all, provider) => `registerAgentExecProvider(${provider},scope){if(scope==="${SCOPE}"){const slot=this._cursorNativeApiExecProviderOv??=new this._agentExecProviderOv.constructor;const registration=slot.set(${provider});this._cursorNativeApiExecSessions??=new Set;this._proxy.$registerAgentExecProvider(scope);return ${disposable}(()=>{registration.dispose();for(const id of this._cursorNativeApiExecSessions)this.$disposeAgentExecSession(id);this._proxy.$unregisterAgentExecProvider(scope)})}return this._agentExecProviderOv.set(${provider}),`);
  source = source.replace(/async \$initializeAgentExecSession\(([\w$]+),([\w$]+)\)\{const ([\w$]+)=await ([\w$]+)\(this\._agentExecProviderOv\)/,
    `async $initializeAgentExecSession($1,$2,scope){if(scope==="${SCOPE}")this._cursorNativeApiExecSessions.add($1);const $3=await $4(scope==="${SCOPE}"?this._cursorNativeApiExecProviderOv:this._agentExecProviderOv)`);
  source = source.replace(/async \$disposeAgentExecSession\(([\w$]+)\)\{/, 'async $disposeAgentExecSession($1){this._cursorNativeApiExecSessions?.delete($1);');
  return source;
}

function patchHostTools(source) {
  const legacy = source.match(/function ([\w$]+)\(([\w$]+),[\w$]+,[\w$]+,[\w$]+\)\{if\(void 0===([\w$]+)\)throw new Error\("Cursor agent runtime is not active"\)/);
  const modern = source.match(/function ([\w$]+)\(([\w$]+),([\w$]+)\)\{if\(void 0===([\w$]+)\)throw new Error\("agent-host-exec factory is not active"\)/);
  const sessionMap = source.match(/function [\w$]+\(([\w$]+)\)\{return ([\w$]+)\.get\(\1\.sessionId\)\?\?\2\.get\(\1\.rootSessionId\)/)[2];
  const nativeResources = source.match(new RegExp(`const ${sessionMap}=new Map,[\\w$]+=new ([\\w$]+)\\.R10`))[1];
  const manager = source.match(/class ([\w$]+)\{constructor\([\w$]+\)\{this\.handlers=\[\],this\.runningExecs=new Map/)[1];
  const managerIndex = source.indexOf('class ' + manager + '{constructor(');
  const protobuf = source.slice(managerIndex, managerIndex + 2400).match(/new ([\w$]+)\.\$Y/)[1];
  const protobufModule = [...source.slice(0, managerIndex).matchAll(new RegExp(`\\b${protobuf}=([\\w$]+)\\((\\d+)\\)`, 'g'))].pop()[2];
  const activation = source.match(/const ([\w$]+)=\{createOrResumeCloudSubagent:/);
  const loader = source.slice(activation.index).match(/await Promise\.all\(\[([\w$]+)\.e\(/)[1];
  const create = `var cursorNativeApiExecFactory;function cursorNativeApiToolProvider(){return (${createToolProvider.toString()})({createResources:workspace=>{const sessionId="cursor-native-api:exec:"+crypto.randomUUID();const options={...workspace,sessionId,conversationSearchHandler:async()=>new Uint8Array(0)};return cursorNativeApiExecFactory(options)},createManager:resources=>${nativeResources}.n6O.fromResources(resources),parseMessage:bytes=>${loader}(${protobufModule}).Ye.fromBinary(bytes),isControl:message=>message instanceof ${loader}(${protobufModule}).$Y,createContext:metadata=>cursorNativeApiContext().with({symbol:Symbol.for("cursor.agentStreamMetadata"),defaultValue:undefined},metadata)})}`;
  const question = source.match(/function ([\w$]+)\(([\w$]+)\)\{return async\([\w$]+,[\w$]+\)=>\{if\("execApproval"===/)[1];
  const factoryName = source.match(/function ([\w$]+)\(\)\{const ([\w$]+)=vo\?\./)[1];
  const context = source.slice(source.lastIndexOf('work:()=>async function(', activation.index)).match(/^work:\(\)=>async function\(([\w$]+)\)/)[1];
  const vscode = source.slice(activation.index).match(/([\w$]+)\.cursor\.onDidChangeGates/)[1];
  const helper = `cursorNativeApiExecFactory=t=>{${sessionMap}.set(t.sessionId,t);return void 0!==${modern[4]}?${modern[1]}({sessionId:t.sessionId,rootSessionId:t.sessionId,backgroundWorkRegistry:Ks,gitExecutor:z,mcpLease:H,askHostQuestion:${question}(t)},t):${legacy[1]}(t,void 0,z,H)};${context}.subscriptions.push(${vscode}.cursor.registerAgentExecProvider(cursorNativeApiToolProvider(),"${SCOPE}"));`;
  source = source.slice(0, legacy.index) + create.replace('cursorNativeApiContext()', factoryName + '()') + source.slice(legacy.index);
  // Register only after the host runtime has exposed its git executor and MCP
  // lease; registering earlier lets Cursor create tool sessions too soon.
  source = source.replace('const kt={loop:it,ownRequestContext:As,hostProcess:"ext_host"', helper + 'const kt={loop:it,ownRequestContext:As,hostProcess:"ext_host"');
  return source;
}

module.exports = { patchToolWorkbench, patchToolExtensionHost, patchHostTools };
