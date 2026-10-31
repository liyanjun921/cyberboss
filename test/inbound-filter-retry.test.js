const test = require("node:test");
const assert = require("node:assert/strict");
const { createInboundFilter } = require("../src/adapters/channel/weixin/message-utils");

const config = { workspaceId: "weixin-workspace" };
const msg = {
  message_type: 1,
  message_id: 991,
  seq: 123,
  from_user_id: "tester@im.wechat",
  item_list: [{ type: 1, text_item: { text: "hi from queue" } }],
};

test("default inbound filter suppresses duplicate in-memory updates", () => {
  const filter = createInboundFilter();
  const first = filter.normalize(msg, config, "account");
  assert.equal(first.text, "hi from queue");
  assert.equal(filter.normalize(msg, config, "account"), null);
});

test("durable spool retry bypasses volatile filter dedup but still normalizes", () => {
  const filter = createInboundFilter();
  const first = filter.normalize(msg, config, "account", { skipDedup: true });
  const retry = filter.normalize(msg, config, "account", { skipDedup: true });
  assert.equal(first.messageId, "991");
  assert.equal(retry.text, "hi from queue");
  assert.equal(retry.senderId, "tester@im.wechat");
});
