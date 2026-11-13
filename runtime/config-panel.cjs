'use strict';

function showConfigPanel(input, ownerWindow) {
  const document = ownerWindow.document;
  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0008;display:grid;place-items:center';
  const panel = document.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '配置模型服务');
  panel.style.cssText = 'position:relative;isolation:isolate;width:min(980px,94vw);height:min(800px,90vh);display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);border:1px solid var(--vscode-widget-border);border-radius:10px;overflow:hidden;box-shadow:0 12px 48px #0006';
  const header = document.createElement('header');
  header.style.cssText = 'position:relative;z-index:2;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:8px 16px;-webkit-app-region:no-drag';
  header.textContent = '配置模型服务';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '关闭';
  close.style.cssText = 'flex-shrink:0;min-width:64px;min-height:44px;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:0;border-radius:6px;padding:0 14px;font:inherit;cursor:pointer;-webkit-app-region:no-drag';
  close.onclick = () => input.dispose();
  header.appendChild(close);
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;min-height:0';
  panel.append(header, body);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  const webview = input.webview;
  webview.claim(input, ownerWindow, undefined);
  const overlayRoot = webview.overlayLayout.root;
  body.id = `${webview.container.id}-configuration`;
  // Glass renders in the window body; its editor layout container is detached.
  // Host the overlay in this dialog, after the element used as its anchor.
  panel.appendChild(overlayRoot);
  webview.setAnchorElement(body, body);
  overlayRoot.style.zIndex = '1';
  input.cursorNativeApiPanel = { reveal: () => webview.focus() };
  const disposed = webview.onDidDispose(() => {
    disposed.dispose();
    backdrop.remove();
    previousFocus.focus();
  });
  webview.focus();
}

module.exports = { showConfigPanel };
