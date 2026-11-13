'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createConversationSession, loadNativeConversationActions } = require('../runtime/conversation-actions.cjs');

function resolveConversationActions(sourceRoot, appRoot, relative = 'extensions/cursor-agent-exec/dist/main.js') {
  const source = fs.existsSync(path.join(sourceRoot, relative)) ? sourceRoot : appRoot;
  const sdk = fs.readFileSync(path.join(source, relative), 'utf8');
  const dedicated = relative.includes('cursor-local-agent-runtime');
  const identifier = name => name.replace(/\$/g, '\\$');
  const clientName = sdk.match(/LocalAgentClient:\(\)=>([\w$]+)/)[1];
  const clientStart = sdk.indexOf(`class ${clientName}{`);
  const client = sdk.slice(clientStart, sdk.indexOf('}resolveModel(', clientStart));
  const [ctx, state, , , listener, , , manager, , , options] = client.match(/async run\(([^)]+)\)/)[1].split(',');
  const privacy = client.match(/\{privacyMode:([\w$]+)\}/)[1];
  const listenerAnchor = client.match(new RegExp(`([\\w$]+)=[\\w$]+\\(${identifier(listener)},${identifier(privacy)}\\),`));
  const generation = client.match(new RegExp(`const ([\\w$]+)=${identifier(options)}\\.generationUUID\\?\\?crypto\\.randomUUID\\(\\)`))[1];
  const transform = client.match(new RegExp(`\\.runStream\\(${identifier(ctx)},[\\w$]+\\(${identifier(state)},${identifier(privacy)}\\),([\\w$]+)\\([\\w$]+,${identifier(privacy)}\\),`))[1];
  const receiverAnchor = client.match(/new [\w$]+\([\w$]+\.promptSession,!1,\{enableRetryRateLimited:![\w$]+\}\),new [\w$]+\)/)[0];
  const injectionStateIndex = sdk.indexOf('contextInjectionState:');
  const updateFactory = [...sdk.slice(0, injectionStateIndex).matchAll(/(?:const|let|var) ([\w$]+)=\{/g)].at(-1)[1];

  const providerStart = dedicated ? sdk.lastIndexOf('async runLocalAgent(') : sdk.indexOf('async runLocalAgent(');
  const provider = dedicated ? sdk.slice(providerStart) : sdk.slice(providerStart, sdk.indexOf('async runLocalInference(', providerStart));
  const managerAnchor = provider.match(/new [\w$]+\(([\w$]+)\),new ([\w$]+),\{(?:async )?handleCheckpoint/);
  const input = dedicated ? provider.match(/void 0!==([\w$]+)\.providerModelCatalog&&/)[1] : provider.match(/async runLocalAgent\(([^,]+)/)[1];
  const callbacks = managerAnchor[1];
  const cancel = provider.match(/,\[[\w$]+,([\w$]+)\]=[\s\S]{0,180}?\.withCancel\(\)/)[1];
  const logger = provider.match(/\.with\(([\w$]+)\._O,/)[1];
  const actionProto = provider.match(new RegExp(`([\\w$]+)\\.QFf\\.fromBinary\\(${identifier(input)}\\.action\\)`))[1];
  const startAnchor = provider.match(dedicated ? /try\{await [\w$]+\.run\(/ : /\(0,[\w$]+\.notifyAgentStoreConversationTurn\)\([\w$]+\.runOptions\.conversationId,"start"\);try\{await [\w$]+\.run\(/)[0];
  const endAnchor = provider.match(dedicated ? /finally\{[\w$]+\?\.removeEventListener\("abort",[\w$]+\)\}/ : /finally\{\(0,[\w$]+\.notifyAgentStoreConversationTurn\)\([\w$]+\.runOptions\.conversationId,"end"\)\}/)[0];

  const hostDirectory = path.join(appRoot, 'extensions/cursor-agent-host/dist');
  const chunk = fs.readdirSync(hostDirectory).filter(file => /^\d+\.js$/.test(file))
    .find(file => fs.readFileSync(path.join(hostDirectory, file), 'utf8').includes('"RemoteConversationActionManager"'));
  const [moduleId, factory] = Object.entries(require(path.join(hostDirectory, chunk)).modules)
    .find(([, factory]) => factory.toString().includes('"RemoteConversationActionManager"'));
  const factorySource = factory.toString();
  const [, loggerId, ledgerId] = factorySource.match(/var [\w$]+=[\w$]+\((\d+)\),[\w$]+=[\w$]+\((\d+)\);const [\w$]+=/);
  const receiverClass = factorySource.match(/class ([\w$]+)\{constructor\([^)]*\)\{this\.mailbox=/)[1];
  const mailboxClass = factorySource.match(/class ([\w$]+)\{constructor\([^)]*\)\{this\.maxActions=/)[1];
  const exportName = name => factorySource.match(new RegExp(`([\\w$]+):\\(\\)=>${identifier(name)}(?:,|\\})`))[1];
  const nativeSpec = { moduleId, loggerId, ledgerId, receiver: exportName(receiverClass), mailbox: exportName(mailboxClass) };
  const host = fs.readFileSync(path.join(sourceRoot, 'extensions/cursor-agent-host/dist/main.js'), 'utf8');
  const ledger = host.match(new RegExp(`${ledgerId}\\(([^)]+)\\)(\\{"use strict";[\\w$]+\\.d\\([\\w$]+,\\{[\\w$]+:\\(\\)=>[\\w$]+\\}\\);class [\\w$]+\\{[\\s\\S]*?\\}\\}),\\d+\\(`));

  return {
    listenerAnchor: listenerAnchor[0],
    receiver: `${options}.cursorNativeApiActions?${manager}.createReceiver(${ctx},${privacy},${listenerAnchor[1]},${transform},${updateFactory}.contextInjectionState,${generation}):${receiverAnchor.match(/new [\w$]+\)$/)[0].slice(0, -1)}`,
    receiverAnchor, managerAnchor: managerAnchor[0], defaultManager: managerAnchor[2], startAnchor, endAnchor,
    session: `${input}.runOptions.cursorNativeApiActions?(${createConversationSession.toString()})(${callbacks},(${loadNativeConversationActions.toString()})(require("node:path").join(__dirname,"../../cursor-agent-host/dist/${chunk}"),function(${ledger[1]})${ledger[2]},${logger},${JSON.stringify(nativeSpec)}),${cancel},bytes=>${actionProto}.QFf.fromBinary(bytes)):new ${managerAnchor[2]}`,
    enabled: `${input}.runOptions.cursorNativeApiActions`
  };
}

function patchSdkConversationActions(source, actions) {
  source = source.replace(actions.listenerAnchor, `${actions.listenerAnchor}nativeReceiver=${actions.receiver},`);
  source = source.replace(actions.receiverAnchor, actions.receiverAnchor.replace(/new [\w$]+\)$/, 'nativeReceiver)'));
  source = source.replace(actions.startAnchor, `const nativeActions=${actions.session};${actions.startAnchor}`);
  source = source.replace(actions.managerAnchor, actions.managerAnchor.replace(`new ${actions.defaultManager},`, 'nativeActions,'));
  source = source.replace(actions.endAnchor, actions.endAnchor.replace('finally{', `finally{if(${actions.enabled})await nativeActions.dispose();`));
  return source;
}

module.exports = { resolveConversationActions, patchSdkConversationActions };
