const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const {
  GARDEN_WAKE_MARKER,
  buildGardenTriggerText,
  enqueueGardenWake,
  readEnvelope,
  resolveGardenTarget,
} = require("../integrations/galatea-garden/inject-cyberboss");
const { SystemMessageQueueStore } = require("../src/core/system-message-queue-store");
const { SystemMessageService } = require("../src/services/system-message-service");
const { persistContextToken } = require("../src/adapters/channel/weixin/context-token-store");

function createFixture({ allowedUserIds = ["wechat-user-1"], workspaceRoots = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-garden-injector-"));
  const accountsDir = path.join(root, "accounts");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(accountsDir, "test-account.json"), JSON.stringify({
    accountId: "test-account",
    rawAccountId: "test-account",
    token: "test-only-token",
    baseUrl: "https://example.invalid",
    userId: "cyberboss-bot",
  }));

  const config = {
    accountId: "test-account",
    accountsDir,
    allowedUserIds,
    workspaceId: "default",
    runtime: "codex",
    workspaceRoot,
    weixinBaseUrl: "https://example.invalid",
  };
  const roots = workspaceRoots.length ? workspaceRoots : [workspaceRoot];
  const binding = {
    activeWorkspaceRoot: roots.length === 1 ? roots[0] : "",
    threadIdByWorkspaceRootByRuntime: {
      codex: Object.fromEntries(roots.map((rootPath, index) => [rootPath, "thread-" + (index + 1)])),
    },
  };
  const sessionStore = {
    buildBindingKey({ workspaceId, accountId, senderId }) {
      return [workspaceId, accountId, senderId].join(":");
    },
    getBinding() {
      return binding;
    },
    getActiveWorkspaceRoot() {
      return binding.activeWorkspaceRoot;
    },
  };
  return { root, config, sessionStore, workspaceRoot };
}

test("reads the official version 1 Garden wake envelope from stdin", async () => {
  const envelope = await readEnvelope(Readable.from([
    JSON.stringify({
      version: 1,
      type: "garden_wake",
      reason: "game_turn_required",
      message: "请检查当前 Garden 状态。",
    }) + "\n",
  ]));

  assert.deepEqual(envelope, {
    version: 1,
    type: "garden_wake",
    reason: "game_turn_required",
    message: "请检查当前 Garden 状态。",
  });
});

test("rejects malformed, unsupported, and oversized Garden envelopes", async () => {
  await assert.rejects(
    readEnvelope(Readable.from(["not-json"])),
    /not valid JSON/,
  );
  await assert.rejects(
    readEnvelope(Readable.from([JSON.stringify({
      version: 2,
      type: "garden_wake",
      reason: "test",
      message: "hello",
    })])),
    /Unsupported Garden wake envelope/,
  );
  await assert.rejects(
    readEnvelope(Readable.from([JSON.stringify({
      version: 1,
      type: "garden_wake",
      reason: "test",
      message: "x".repeat(20_000),
    })])),
    /16 KiB limit/,
  );
});

test("marks and preserves the Garden reason and server message", () => {
  const text = buildGardenTriggerText({
    reason: "game_turn_required",
    message: "游戏轮到你了，请读取当前状态。",
  });

  assert.ok(text.includes(GARDEN_WAKE_MARKER));
  assert.match(text, /reason: game_turn_required/);
  assert.match(text, /游戏轮到你了，请读取当前状态。/);
});

test("queues a Garden wake through Cyberboss's native system-message service contract", () => {
  const fixture = createFixture();
  let queuedInput = null;
  const systemMessageService = {
    queueMessage(input) {
      queuedInput = input;
      return { id: "queue-item-1" };
    },
  };

  const result = enqueueGardenWake({
    version: 1,
    type: "garden_wake",
    reason: "game_turn_required",
    message: "请读取当前 Garden 状态。",
  }, {
    config: fixture.config,
    sessionStore: fixture.sessionStore,
    systemMessageService,
    env: {},
  });

  assert.equal(result.id, "queue-item-1");
  assert.equal(result.accountId, "test-account");
  assert.equal(result.senderId, "wechat-user-1");
  assert.equal(result.workspaceRoot, fixture.workspaceRoot);
  assert.equal(queuedInput.userId, "wechat-user-1");
  assert.equal(queuedInput.workspaceRoot, fixture.workspaceRoot);
  assert.match(queuedInput.text, /\[GARDEN_WAKE_EVENT\]/);
  assert.match(queuedInput.text, /请读取当前 Garden 状态。/);
});

test("does not guess when more than one WeChat sender is allowed", () => {
  const fixture = createFixture({ allowedUserIds: ["wechat-user-1", "wechat-user-2"] });

  assert.throws(
    () => resolveGardenTarget({
      config: fixture.config,
      sessionStore: fixture.sessionStore,
      env: {},
    }),
    /Multiple allowed WeChat users/,
  );
});

test("does not guess when more than one workspace binding is available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-garden-workspaces-"));
  const workspaceA = path.join(root, "workspace-a");
  const workspaceB = path.join(root, "workspace-b");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const fixture = createFixture({ workspaceRoots: [workspaceA, workspaceB] });

  assert.throws(
    () => resolveGardenTarget({
      config: fixture.config,
      sessionStore: fixture.sessionStore,
      env: {},
    }),
    /Could not resolve one bound workspace/,
  );

  const target = resolveGardenTarget({
    config: fixture.config,
    sessionStore: fixture.sessionStore,
    env: { GARDEN_CYBERBOSS_WORKSPACE_ROOT: workspaceB },
  });
  assert.equal(target.workspaceRoot, workspaceB);
});


test("uses the real Cyberboss SystemMessageService and persists a Garden wake", () => {
  const fixture = createFixture();
  const config = {
    ...fixture.config,
    systemMessageQueueFile: path.join(fixture.root, "system-message-queue.json"),
  };
  persistContextToken(config, "test-account", "wechat-user-1", "context-token-for-test");
  const systemMessageService = new SystemMessageService({
    config,
    sessionStore: fixture.sessionStore,
  });

  const result = enqueueGardenWake({
    version: 1,
    type: "garden_wake",
    reason: "forum_notification_available",
    message: "有一条新的论坛通知。",
  }, {
    config,
    sessionStore: fixture.sessionStore,
    systemMessageService,
    env: {},
  });

  const queue = new SystemMessageQueueStore({ filePath: config.systemMessageQueueFile });
  const pending = queue.drainForAccount("test-account");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, result.id);
  assert.equal(pending[0].senderId, "wechat-user-1");
  assert.equal(pending[0].workspaceRoot, fixture.workspaceRoot);
  assert.match(pending[0].text, /forum_notification_available/);
  assert.match(pending[0].text, /有一条新的论坛通知。/);
});

test("the native queue persists an accepted wake without editing session files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-garden-queue-"));
  const queuePath = path.join(root, "system-message-queue.json");
  const queue = new SystemMessageQueueStore({ filePath: queuePath });
  const queued = queue.enqueue({
    id: "garden-event-1",
    accountId: "test-account",
    senderId: "wechat-user-1",
    workspaceRoot: root,
    text: "[GARDEN_WAKE_EVENT] test",
    createdAt: new Date().toISOString(),
  });

  assert.equal(queued.id, "garden-event-1");
  const saved = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].senderId, "wechat-user-1");
});
