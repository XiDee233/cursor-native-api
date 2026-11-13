'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;

function newer(candidate, current) {
  const parse = value => String(value).replace(/^v/i, '').split('.').map(Number);
  const [a, b] = [parse(candidate), parse(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] || 0;
    const right = b[index] || 0;
    if (left !== right) return left > right;
  }
  return false;
}

function repository(context) {
  const value = context.extension.packageJSON.repository;
  const url = typeof value === 'string' ? value : value?.url;
  const match = url?.match(/github\.com[/:]([^/]+)\/([^/#]+)/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/i, '')}` : undefined;
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
    if (!this.repo) {
      if (interactive) vscode.window.showInformationMessage('Cursor Native API：尚未配置 GitHub 仓库地址，无法检查更新。');
      return;
    }
    const current = this.context.extension.packageJson.version;
    const release = await this.release();
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!newer(latest, current)) {
      if (interactive) vscode.window.showInformationMessage(`Cursor Native API：已是最新版本 ${current}。`);
      return;
    }
    const asset = (release.assets || []).find(item => item.name.endsWith('.vsix'));
    if (!asset) throw new Error(`新版本 ${latest} 没有附带 VSIX 安装包。`);
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
    const digest = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined;
    if (digest && crypto.createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw new Error('更新包校验失败，已丢弃。');
    }
    fs.writeFileSync(file, bytes);
    return file;
  }
  checkInBackground() {
    const last = this.context.globalState.get('updateCheckedAt') || 0;
    if (Date.now() - last < DAY) return;
    this.context.globalState.update('updateCheckedAt', Date.now());
    this.check().catch(error => this.output.appendLine(error.message));
  }
}

module.exports = { Updates, newer };
