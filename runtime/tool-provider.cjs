'use strict';

function createToolProvider({ createResources, createManager, parseMessage, isControl, createContext }) {
  const sessions = new Set();
  return {
    createSession(approvalHandler, elicitationHandler, fileChangeHandler, workspace, getPermissions, onDidChangePermissions) {
      const resources = createResources({ ...workspace, approvalHandler, mcpElicitationHandler: elicitationHandler, fileChangeHandler, getPermissions, onDidChangePermissions });
      const manager = createManager(resources);
      const session = {
        async *createStream(metadata, bytes, signal) {
          const [ctx, cancel] = createContext(metadata).withCancel();
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
          try {
            for await (const message of manager.handle(ctx, parseMessage(bytes))) {
              const body = message.toBinary();
              const frame = new Uint8Array(body.length + 1);
              frame[0] = isControl(message) ? 67 : 77;
              frame.set(body, 1);
              yield frame;
            }
          } finally {
            signal.removeEventListener('abort', cancel);
            cancel();
          }
        },
        dispose() { sessions.delete(session); return resources.dispose(); }
      };
      sessions.add(session);
      return session;
    },
    dispose() { for (const session of sessions) session.dispose(); }
  };
}

module.exports = { createToolProvider };
