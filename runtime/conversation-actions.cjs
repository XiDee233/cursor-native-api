'use strict';

// The native manager owns submission and replay. This channel only crosses the
// renderer / extension-host boundary; native interaction updates confirm delivery.
function connectConversationActions(manager, ctx, stream, serialize) {
  const reader = stream[Symbol.asyncIterator]();
  const pumping = manager.run(ctx, {
    async write(action) { await stream.write(await serialize(action)); }
  });
  return async operation => {
    if (operation === 'next') return reader.next();
    manager.close();
    stream.close();
    await pumping;
  };
}

// Factories come from Cursor's own RemoteConversationActionManager and injection
// ledger. No second implementation of admission, deduplication or delivery state.
function createConversationSession(callbacks, native, cancel, decode) {
  const cleanups = [];
  let updates = Promise.resolve();
  return {
    createReceiver(ctx, privacy, listener, transform, injectionState, runId) {
      const receiver = new native.Receiver(ctx, new native.Mailbox(32), cancel, {
        contextInjection: {
          activeRunId: runId,
          deferDeliveredAck: true,
          onInjectionStateChange(id, state) {
            updates = updates.then(() => listener.sendUpdate(ctx, injectionState(privacy, id, state)));
            updates.catch(cancel);
          }
        }
      });
      const pumping = (async () => {
        for (;;) {
          const bytes = await callbacks.conversationAction('next');
          if (bytes.byteLength === 0) return;
          receiver.push(transform(decode(bytes), privacy));
        }
      })();
      pumping.catch(error => cancel(error));
      cleanups.push(async () => {
        try { await pumping; }
        finally { receiver.endRun(); await updates; }
      });
      return receiver;
    },
    async dispose() {
      await callbacks.conversationAction('close');
      for (const cleanup of cleanups) await cleanup();
    }
  };
}

function loadNativeConversationActions(chunkPath, ledgerFactory, logger, spec) {
  const ledger = {};
  const define = (target, getters) => {
    for (const [name, get] of Object.entries(getters)) Object.defineProperty(target, name, { get });
  };
  ledgerFactory({}, ledger, { d: define });
  const dependencies = { [spec.loggerId]: logger, [spec.ledgerId]: ledger };
  const load = id => dependencies[id];
  load.d = define;
  const actions = {};
  require(chunkPath).modules[spec.moduleId]({}, actions, load);
  return { Receiver: actions[spec.receiver], Mailbox: actions[spec.mailbox] };
}

module.exports = { connectConversationActions, createConversationSession, loadNativeConversationActions };
