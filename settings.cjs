'use strict';
const vscode = require('vscode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { presets } = require('./capabilities.cjs');
const { Profiles } = require('./profiles.cjs');
const { ModelService } = require('./model-service.cjs');
const { createCatalog } = require('./catalog.cjs');

class Settings {
  constructor(context, installation) {
    this.context = context; this.installation = installation;
    this.profiles = new Profiles(context);
    this.models = new ModelService(context.secrets);
  }
  bridge(action, payload) {
    return vscode.commands.executeCommand('cursor.openLocalAgentConfigurationModal', { __cursorNativeApi: 2, action, ...payload });
  }
  async initialize() { await this.apply(this.profiles.all); }
  provider(serviceId) { return this.profiles.credentials(serviceId); }
  async apply(profiles) {
    const ready = this.installation.status().ready;
    const enabled = this.context.globalState.get('integrationEnabled', true);
    if (!ready || !enabled) return false;
    await this.bridge('apply', { catalog: createCatalog(profiles) });
    return true;
  }
  async state(webview) {
    webview.postMessage({ type: 'state', version: this.context.extension.packageJSON.version, profiles: await this.profiles.read(), presets, installation: this.installation.status() });
  }
  async save(message, webview) {
    const profiles = await this.profiles.save(message.profiles, message.apiKeys);
    const applied = await this.apply(profiles);
    webview.postMessage({ type: 'saved', revision: message.revision, profiles: await this.profiles.read(),
      message: applied ? '全部配置已保存，模型菜单已更新。' : '全部配置已保存。' + this.installation.status().message });
  }
  connect(webview) {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    const uri = file => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file)).toString();
    const nonce = crypto.randomBytes(20).toString('hex');
    webview.html = fs.readFileSync(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'config.html').fsPath, 'utf8')
      .replaceAll('{{csp}}', webview.cspSource).replaceAll('{{nonce}}', nonce)
      .replaceAll('{{css}}', uri('config.css')).replaceAll('{{script}}', uri('config.js'));
    this.context.subscriptions.push(webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ready') { await this.state(webview); return; }
        if (message.type === 'save') { await this.save(message, webview); return; }
        if (message.type === 'installationStatus') { this.installation.showStatus(); return; }
        if (message.type === 'key') {
          webview.postMessage({ type: 'key', serviceId: message.serviceId, requestId: message.requestId, apiKey: await this.profiles.secret(message.serviceId) });
          return;
        }
        if (message.type === 'install' || message.type === 'restore') {
          const result = await this.installation.schedule(message.type === 'install' ? 'enable' : 'restore');
          webview.postMessage({ type: 'installation', installation: this.installation.status() });
          webview.postMessage({ message: result }); return;
        }
        webview.postMessage(await this.models.request(message));
      } catch (error) {
        webview.postMessage({ type: 'error', requestType: message.type, requestId: message.requestId, serviceId: message.serviceId, message: error.message });
      }
    }));
  }
  open() {
    if (this.panel) { this.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel('cursorNativeApi.config', '配置模型服务', vscode.ViewColumn.Active, { enableScripts: true });
    this.panel = panel;
    panel.onDidDispose(() => { this.panel = undefined; });
    this.connect(panel.webview);
  }
}
module.exports = { Settings };
