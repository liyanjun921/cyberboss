const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { CyberbossApp } = require("../src/core/app");
const { PersistentImageBatchStore } = require("../src/core/persistent-image-batch-store");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-buffer-recovery-"));
  t.after(async () => fsp.rm(root, { recursive: true, force: true }));
  const app = Object.create(CyberbossApp.prototype);
  app.pendingTurnBatchStore = new PersistentImageBatchStore({
    filePath: path.join(root, "pending-turn-batches.json"),
  });
  app.pendingInboundByScope = new Map(app.pendingTurnBatchStore.load());
  app.pendingTurnFlushScopes = new Set();
  app.channelAdapter = { sendTyping: async () => {} };
  return { app, root };
}
function prepared(text = "hello") {
  return {
    workspaceId: "workspace", accountId: "account", senderId: "sender",
    provider: "weixin", text, originalText: text, contextToken: "fake",
    receivedAt: "2026-10-31T00:00:00Z", attachments: [], attachmentFailures: [],
  };
}

test("Codex-busy turn is persisted before inbound raw spool can be acknowledged", async (t) => {
  const { app, root } = await fixture(t);
  app.isTurnDispatchBlocked = () => true;
  const result = await app.routePreparedInbound({
    bindingKey: "binding", workspaceRoot: root, prepared: prepared(),
  });
  assert.equal(result, true);
  assert.equal(app.pendingInboundByScope.size, 1);
  assert.equal(new PersistentImageBatchStore({
    filePath: path.join(root, "pending-turn-batches.json"),
  }).load()[0][1].messages[0].text, "hello");
});

test("failed Codex turn keeps durable pending text; successful dispatch removes it", async (t) => {
  const { app, root } = await fixture(t);
  app.bufferPendingInboundMessage({
    bindingKey: "binding", workspaceRoot: root, prepared: prepared(),
  });
  app.isTurnDispatchBlocked = () => false;
  app.dispatchPreparedTurn = async () => false;
  await app.flushPendingInboundMessages();
  assert.equal(app.pendingInboundByScope.size, 1);
  assert.equal(app.pendingTurnBatchStore.load()[0][1].messages.length, 1);

  app.dispatchPreparedTurn = async () => true;
  await app.flushPendingInboundMessages();
  assert.equal(app.pendingInboundByScope.size, 0);
  assert.equal(app.pendingTurnBatchStore.load().length, 0);
});

test("direct Codex dispatch failure rejects raw spool acknowledgment", async (t) => {
  const { app } = await fixture(t);
  app.runtimeAdapter = {
    getSessionStore() { return { buildBindingKey() { return "binding"; } }; },
  };
  app.streamDelivery = { setReplyTarget() {} };
  app.resolveWorkspaceRoot = () => "/tmp/unused";
  app.prepareIncomingMessageForRuntime = async () => prepared("hello");
  app.hasPendingImageInbound = () => false;
  app.routePreparedInbound = async () => false;
  await assert.rejects(
    app.handlePreparedMessage(prepared("hello"), { allowCommands: true }),
    /retaining inbound spool item/
  );
});

test("failed disk write does not acknowledge a blocked turn", async (t) => {
  const { app, root } = await fixture(t);
  app.pendingTurnBatchStore.save = () => { throw new Error("disk is full"); };
  app.isTurnDispatchBlocked = () => true;
  await assert.rejects(app.routePreparedInbound({
    bindingKey: "binding", workspaceRoot: root, prepared: prepared(),
  }), /disk is full/);
  assert.equal(app.pendingInboundByScope.size, 0);
});
