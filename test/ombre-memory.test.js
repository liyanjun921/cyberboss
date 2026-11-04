const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { OmbreMemoryService } = require("../src/services/ombre-memory-service");
const { CyberbossApp } = require("../src/core/app");
const { StreamDelivery } = require("../src/core/stream-delivery");
const { mapCodexMessageToRuntimeEvent } = require("../src/adapters/runtime/codex/events");

function fixture(t, fetchImpl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ombre-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { stateDir: dir, workspaceRoot: "/companion", ombreWorkspaceRoot: "/companion",
    ombreBaseUrl: "https://memory.example", ombreToken: "x".repeat(32), ombreTimeoutMs: 30 };
  return { config, service: new OmbreMemoryService(config, { fetchImpl }) };
}

const prepared = { provider: "weixin", accountId: "account-demo", senderId: "sender-demo", messageId: "m1",
  text: "虚构测试：一起讨论蓝色车票。", originalText: "虚构测试：一起讨论蓝色车票。",
  receivedAt: "2026-10-31T04:00:00Z" };

test("断网消息保留，重启后补传；确认回执后去重且不记录 Token", async (t) => {
  const { config, service } = fixture(t, async () => { throw new Error("offline"); });
  assert.equal(service.recordUser(prepared, "/companion"), true);
  await service.flush({ force: true });
  assert.equal(service.status().pending, 1);
  const sent = [];
  const restarted = new OmbreMemoryService(config, { fetchImpl: async (url, options) => {
    sent.push(JSON.parse(options.body));
    assert.equal(options.redirect, "error");
    return Response.json({ ok: true, inserted: 1, duplicates: 0, ids: [1] });
  } });
  await restarted.flush({ force: true });
  assert.equal(restarted.status().pending, 0);
  assert.equal(sent[0].messages[0].text, prepared.text);
  restarted.recordUser(prepared, "/companion");
  assert.equal(restarted.status().pending, 0);
  const disk = fs.readdirSync(restarted.queueDir).map((name) => fs.readFileSync(path.join(restarted.queueDir, name), "utf8")).join("");
  assert.ok(!disk.includes(config.ombreToken));
});

test("关闭、非指定工作区、系统消息不归档；公网 HTTP 配置被拒绝", (t) => {
  const { config, service } = fixture(t, async () => {});
  assert.equal(service.recordUser(prepared, "/work-project"), false);
  assert.equal(service.recordUser({ ...prepared, provider: "system" }, "/companion"), false);
  assert.equal(service.status().pending, 0);
  assert.equal(new OmbreMemoryService({ stateDir: config.stateDir }).enabled, false);
  assert.equal(new OmbreMemoryService({ ...config, ombreBaseUrl: "http://public.example" }).enabled, false);
  assert.equal(new OmbreMemoryService({ ...config, ombreBaseUrl: "https://memory.example?token=bad" }).enabled, false);
});

test("冲突原话隔离保留，下一条仍能同步；假回执不能删队列", async (t) => {
  const { config, service } = fixture(t, async () => Response.json({ error: "conflict" }, { status: 409 }));
  service.recordUser(prepared, "/companion");
  await service.flush({ force: true });
  assert.equal(service.status().blocked, 1);
  const retry = new OmbreMemoryService(config, { fetchImpl: async () => Response.json({ ok: true }) });
  retry.recordUser({ ...prepared, messageId: "m2" }, "/companion");
  await retry.flush({ force: true });
  assert.equal(retry.status().pending, 1);
  assert.equal(retry.status().blocked, 1);
});

test("共享记忆进入实际组装的模型输入，检索失败仍能正常组装", async (t) => {
  const { config, service } = fixture(t, async () => Response.json({ ok: true,
    memory_status: "ok", memory: "虚构长期记忆：她收藏蓝色车票。", recent: [
      { platform: "chatgpt", role: "assistant", text: "虚构官端近况。", created_at: "2026-10-31T03:00:00Z" },
    ] }));
  const app = { config, ombreMemory: service, runtimeAdapter: { getTurnCapabilities: () => ({}) } };
  const turn = await CyberbossApp.prototype.buildRuntimeTurn.call(app, { prepared, workspaceRoot: "/companion" });
  assert.match(turn.text, /她收藏蓝色车票/);
  assert.match(turn.text, /chatgpt/);
  assert.match(turn.text, /历史参考/);
  service.fetchImpl = async () => { throw new Error("offline"); };
  const offline = await CyberbossApp.prototype.buildRuntimeTurn.call(app, { prepared, workspaceRoot: "/companion" });
  assert.match(offline.text, /讨论蓝色车票/);
  assert.ok(!offline.text.includes("虚构官端近况"));
});

test("只在气泡成功送达后归档，延迟发送不冒充成功", async () => {
  const records = [];
  const delivery = new StreamDelivery({ channelAdapter: { sendText: async () => {} }, sessionStore: {},
    onDeliveredReply: (value) => records.push(value), onDeferredSystemReply: async () => true });
  const state = { threadId: "thread", turnId: "turn", bindingKey: "binding",
    replyTarget: { userId: "u", contextToken: "ctx", provider: "weixin" } };
  await delivery.sendReplyDelivery(state, { kind: "plain", itemId: "item", text: "虚构回复" });
  assert.equal(records.length, 1);
  assert.equal(records[0].text, "虚构回复");
  delivery.channelAdapter.sendText = async () => { throw new Error("offline"); };
  await assert.rejects(delivery.sendReplyDelivery(state, { kind: "plain", itemId: "failed", text: "未送达" }));
  assert.equal(records.length, 1);
  delivery.deferSystemReply = async () => true;
  await delivery.sendReplyDelivery(state, { kind: "plain", itemId: "item2", text: "未送达" });
  assert.equal(records.length, 1);
});

test("Codex 失败或取消的 completed 事件不会强制发送并归档半截回复", () => {
  for (const status of ["failed", "interrupted", "cancelled"]) {
    const event = mapCodexMessageToRuntimeEvent({ method: "turn/completed",
      params: { threadId: "t", turn: { id: "r", status } } });
    assert.equal(event.type, "runtime.turn.failed");
  }
});

test("本地回执防止同一已送达气泡重放后用新时间再次入库", async (t) => {
  const { service } = fixture(t, async () => Response.json({ ok: true, inserted: 1, duplicates: 0, ids: [1] }));
  const reply = { workspaceRoot: "/companion", accountId: "a", senderId: "s", threadId: "t", turnId: "r",
    itemId: "i", text: "虚构回复", provider: "weixin" };
  assert.equal(service.recordDelivered(reply), true);
  await service.flush({ force: true });
  assert.equal(service.recordDelivered(reply), true);
  assert.equal(service.status().pending, 0);
});
