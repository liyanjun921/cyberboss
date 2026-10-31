const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DurableInboundQueue } = require("../src/core/durable-inbound-queue");

async function fixture(t, maxPending = 500) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-inbound-spool-"));
  t.after(async () => { await fsp.rm(root, { recursive: true, force: true }); });
  const filePath = path.join(root, "spool", "inbound.json");
  return { filePath, queue: new DurableInboundQueue({ filePath, maxPending }) };
}
function msg(id, user = "u") {
  return { msg_id: id, from_user_id: user, item_list: [{ type: 1, text: { content: "hello" } }] };
}

test("new updates persist and survive restart before ack", async (t) => {
  const { filePath, queue } = await fixture(t);
  assert.equal(queue.enqueueBatch([msg(1), msg(2)]), 2);
  assert.equal(queue.pendingCount, 2);
  const recovered = new DurableInboundQueue({ filePath });
  assert.equal(recovered.pendingCount, 2);
  assert.equal(recovered.peek().raw.msg_id, 1);
  recovered.ack(recovered.peek().key);
  assert.equal(recovered.peek().raw.msg_id, 2);
  const recoveredAgain = new DurableInboundQueue({ filePath });
  assert.equal(recoveredAgain.pendingCount, 1);
});

test("replayed getUpdates does not enqueue already acknowledged or pending messages", async (t) => {
  const { queue } = await fixture(t);
  assert.equal(queue.enqueueBatch([msg(1), msg(2)]), 2);
  assert.equal(queue.enqueueBatch([msg(1), msg(2)]), 0);
  queue.ack(queue.peek().key);
  assert.equal(queue.enqueueBatch([msg(1), msg(2), msg(3)]), 1);
  assert.equal(queue.pendingCount, 2);
});

test("same msg id from independent user scopes is retained", async (t) => {
  const { queue } = await fixture(t);
  assert.equal(queue.enqueueBatch([msg(42, "alice"), msg(42, "bob")]), 2);
});

test("full queue never truncates pending entries", async (t) => {
  const { filePath, queue } = await fixture(t, 2);
  queue.enqueueBatch([msg(1), msg(2)]);
  assert.throws(() => queue.enqueueBatch([msg(3)]), /spool full/);
  assert.equal(new DurableInboundQueue({ filePath }).pendingCount, 2);
});

test("invalid spool fails closed instead of discarding pending messages", async (t) => {
  const { filePath } = await fixture(t);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{broken");
  assert.throws(() => new DurableInboundQueue({ filePath }), /refusing to advance WeChat checkpoint/);
});

test("duplicate IDs within the same batch are persisted once", async (t) => {
  const { queue } = await fixture(t);
  assert.equal(queue.enqueueBatch([msg(1), msg(1), msg(2)]), 2);
});
