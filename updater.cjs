'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;

function newer(candidate, current) {
  const parse = value => String(value).replace(/^v/i, '').split('.').map(Number);
  const [next, installed] = [parse(candidate), parse(current)];
  for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
    const left = next[index] || 0;
    const right = installed[index] || 0;
    if (left !== right) return left > right;
  }
  return false;
}

function repository(context) {
  const url = context.extension.packageJSON.repository.url;
  const match = url.match(/github\.com[/:]([^/]+)\/([^/#]+)/i);
  return `${match[1]}/${match[2].replace(/\.git$/i, '')}`;
}

class Updates {
  constructor(context, output) {
    this.context = context;
    this.output = output;
    this.repo = repository(context);
    this.storage = context.globalStorageUri.fsPath;
  }
  async release() {
    const response = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cursor-native-api' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`检查更新失败：HTTP ${response.status}`);
    return response.json();
  }
  async check({ interactive = false } = {}) {
    const current = this.context.extension.packageJSON.version;
    const release = await this.release();
    const latest = String(release.tag_name).replace(/^v/i, '');
    if (!newer(latest, current)) {
      if (interactive) vscode.window.showInformationMessage(`Cursor Native API：已是最新版本 ${current}。`);
      return;
    }
    const asset = release.assets.find(item => item.name.endsWith('.vsix'));
    const choice = await vscode.window.showInformationMessage(
      `Cursor Native API：发现新版本 ${latest}（当前 ${current}）。`, '安装并重启', '稍后');
    if (choice !== '安装并重启') return;
    const file = await this.download(asset, latest);
    await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(file));
    const reload = await vscode.window.showInformationMessage(`Cursor Native API 已更新到 ${latest}。`, '重新加载窗口');
    if (reload) await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
  async download(asset, version) {
    const directory = path.join(this.storage, 'updates');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, asset.name);
    this.output.appendLine(`下载更新 ${version}：${asset.browser_download_url}`);
    const response = await fetch(asset.browser_download_url, {
      headers: { 'User-Agent': 'cursor-native-api' }, signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`下载更新失败：HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.digest.replace(/^sha256:/, '')) {
      throw new Error('更新包校验失败，已丢弃。');
    }
    fs.writeFileSync(file, bytes);
    return file;
  }
  checkInBackground() {
    if (Date.now() - this.context.globalState.get('updateCheckedAt', 0) < DAY) return;
    this.context.globalState.update('updateCheckedAt', Date.now());
    this.check().catch(error => this.output.appendLine(error.message));
  }
}

module.exports = { Updates, newer };
