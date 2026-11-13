'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

class Installation {
  constructor(context, patcher, output) {
    this.context = context; this.patcher = patcher; this.output = output;
    this.isNewInstallation = !context.globalState.get('installationId');
    this.audit = new Promise((resolve, reject) => {
      execFile(vscode.env.bundledNodePath(), [path.join(context.extensionPath, 'patcher.cjs'), 'status', '--app-root', vscode.env.appRoot], { windowsHide: true }, (error, stdout) => {
        if (error) { reject(error); return; }
        const job = JSON.parse(stdout);
        if (job.state === 'failed') { reject(new Error(job.error)); return; }
        this.snapshot = job.result;
        this.auditedAt = Date.now();
        resolve();
      });
    });
    this.storage = context.globalStorageUri.fsPath;
    this.jobPath = path.join(this.storage, 'job.json');
    fs.mkdirSync(this.storage, { recursive: true });
  }
  status() {
    const job = fs.existsSync(this.jobPath) ? JSON.parse(fs.readFileSync(this.jobPath, 'utf8').replace(/^\uFEFF/, '')) : { state: 'idle' };
    const currentJob = job.revision === this.patcher.REVISION;
    const state = currentJob && job.state === 'completed' && Date.parse(job.at) > this.auditedAt ? job.result : this.snapshot;
    const ready = state.enabled && state.revision === state.targetRevision;
    const restoring = job.action === 'restore';
    const waiting = currentJob && job.state === 'waiting-for-exit' && (restoring || !ready);
    const failed = currentJob && job.state === 'failed' && !ready;
    const unfinished = ['prepared', 'recovery-required'].includes(state.state);
    const canApply = state.supported && !ready && (state.enabled || ['original', 'restored'].includes(state.state));
    const label = failed ? '安装任务未完成' : unfinished ? '安装未完成' : !state.supported ? '请更新插件' : waiting ? (restoring ? '等待停用' : '请重新打开 Cursor') : ready ? '已就绪' : canApply ? '需要完成安装' : '需要检查安装';
    const message = failed ? job.error : unfinished ? '安装尚未完成，请在高级设置中查看安装状态。' : !state.supported ? `请更新插件以适配当前 Cursor ${state.version}。已保存的配置会保留。` : waiting ? `已安排${restoring ? '停用模型服务' : '安装'}，正常退出并重新打开 Cursor 后生效。` : ready ? '在 Agent 模型菜单中点击 Edit 调整推理强度。' : canApply ? '完成安装后，正常退出并重新打开 Cursor 一次即可使用。' : '暂时无法完成安装，请在高级设置中查看安装状态。';
    return { ...state, ready, waiting, canApply: canApply && !waiting, label, message };
  }
  showStatus() {
    this.output.appendLine(JSON.stringify(this.status(), null, 2));
    if (fs.existsSync(this.jobPath)) this.output.appendLine(fs.readFileSync(this.jobPath, 'utf8'));
    this.output.show(true);
  }
  async disableUpdates() {
    await vscode.workspace.getConfiguration('update').update('mode', 'none', vscode.ConfigurationTarget.Global);
  }
  async initialize() {
    if (this.isNewInstallation) {
      await this.context.globalState.update('installationId', true);
    }
    const state = this.status();
    await vscode.commands.executeCommand('setContext', 'cursorNativeApi.integrated', state.ready);
    await this.disableUpdates();
    if (this.context.globalState.get('integrationEnabled', true) === false) return;
    if (state.ready || state.waiting) return;
    if (state.canApply) {
      const message = await this.schedule('enable');
      vscode.window.showInformationMessage(`Cursor Native API：${message}`);
      return;
    }
    const notice = `${state.version}:${state.targetRevision}:${state.state}`;
    if (this.context.globalState.get('installationNotice') === notice) return;
    await this.context.globalState.update('installationNotice', notice);
    vscode.window.showInformationMessage(`Cursor Native API：${state.message}`);
  }
  async schedule(action) {
    const state = this.status();
    if (state.waiting) return state.message;
    if (action === 'enable') {
      if (state.ready) return state.message;
      this.patcher.plan(vscode.env.appRoot, state.enabled ? state.backup : undefined);
    } else if (!state.backup) throw new Error('没有当前 Cursor 版本的可恢复备份。');
    await this.context.globalState.update('integrationEnabled', action === 'enable');
    const worker = path.join(this.storage, `worker-${this.patcher.REVISION}`);
    fs.mkdirSync(worker, { recursive: true });
    fs.copyFileSync(path.join(this.context.extensionPath, 'patcher.cjs'), path.join(worker, 'patcher.cjs'));
    for (const dir of ['adapters', 'runtime']) fs.cpSync(path.join(this.context.extensionPath, dir), path.join(worker, dir), { recursive: true });
    fs.writeFileSync(this.jobPath, JSON.stringify({ at: new Date().toISOString(), revision: this.patcher.REVISION, state: 'waiting-for-exit', action }));
    const child = spawn(vscode.env.bundledNodePath(), [path.join(worker, 'patcher.cjs'), action, '--app-root', vscode.env.appRoot, '--wait', '--job', this.jobPath], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.once('error', error => vscode.window.showErrorMessage(`无法启动安装任务：${error.message}`));
    child.unref();
    return `已安排${action === 'enable' ? '安装' : '停用模型服务'}，正常退出并重新打开 Cursor 后生效。`;
  }
}
module.exports = { Installation };
