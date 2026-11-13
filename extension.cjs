'use strict';
const vscode = require('vscode');
const patcher = require('./patcher.cjs');
const { Installation } = require('./installation.cjs');
const { Settings } = require('./settings.cjs');
const { Updates } = require('./updater.cjs');
function activate(context) {
  const output = vscode.window.createOutputChannel('Cursor Native API');
  const installation = new Installation(context, patcher, output);
  const settings = new Settings(context, installation);
  const updates = new Updates(context, output);
  const run = fn => async (...args) => {
    try { await installation.audit; return await fn(...args); }
    catch (error) { output.appendLine(error.stack); vscode.window.showErrorMessage('Cursor Native API：'+error.message); }
  };
  for (const [command, handler] of [
    ['cursorNativeApi.settings', () => settings.open()],
    ['cursorNativeApi.provider', serviceId => settings.provider(serviceId)],
    ['cursorNativeApi.enable', async () => { await installation.schedule('enable'); settings.open(); }],
    ['cursorNativeApi.restore', async () => vscode.window.showInformationMessage(await installation.schedule('restore'))],
    ['cursorNativeApi.status', () => installation.showStatus()],
    ['cursorNativeApi.checkUpdate', () => updates.check({ interactive: true })]
  ]) context.subscriptions.push(vscode.commands.registerCommand(command, run(handler)));
  context.subscriptions.push(output);
  run(async () => {
    await settings.initialize();
    await installation.initialize();
    if (installation.isNewInstallation) {
      settings.open();
    }
  })();
  const timer = setTimeout(() => updates.checkInBackground(), 8000);
  context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}
module.exports = { activate };
