const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMergedInboundPrepared,
  shouldBatchImageOnlyInbound,
  takeImageOnlyBatchMessages,
} = require("../src/core/inbound-turn");

function imageMessage(n, senderId = "sender-a") {
  return {
    senderId,
    bindingKey: `scope-${senderId}`,
    workspaceRoot: "test-workspace",
    text: "",
    originalText: "",
    receivedAt: new Date(2026, 9, 31, 10, 0, n).toISOString(),
    attachments: [{
      kind: "image",
      isImage: true,
      absolutePath: `/test/inbox/image-${n}.gif`,
      sourceFileName: `image-${n}.gif`,
    }],
    attachmentFailures: [],
  };
}

test("three image-only messages merge into one ordered batch", () => {
  const messages = [imageMessage(0), imageMessage(1), imageMessage(2)];
  assert.equal(messages.every(shouldBatchImageOnlyInbound), true);
  const result = takeImageOnlyBatchMessages(messages, 10);
  assert.equal(result.remainingMessages.length, 0);
  const merged = buildMergedInboundPrepared({
    bindingKey: "scope-sender-a", workspaceRoot: "test-workspace", messages: result.batchMessages,
  });
  assert.deepEqual(merged.attachments.map((a) => a.sourceFileName),
    ["image-0.gif", "image-1.gif", "image-2.gif"]);
});

test("twelve images split into ten and two without loss or duplication", () => {
  const messages = Array.from({ length: 12 }, (_, n) => imageMessage(n));
  const first = takeImageOnlyBatchMessages(messages, 10);
  assert.equal(first.batchMessages.reduce((n, m) => n + m.attachments.length, 0), 10);
  const second = takeImageOnlyBatchMessages(first.remainingMessages, 10);
  assert.equal(second.batchMessages.reduce((n, m) => n + m.attachments.length, 0), 2);
  assert.equal(second.remainingMessages.length, 0);
  const files = [...first.batchMessages, ...second.batchMessages]
    .flatMap((m) => m.attachments.map((a) => a.sourceFileName));
  assert.equal(new Set(files).size, 12);
});

test("text after an image can be retained as a batch caption", () => {
  const image = imageMessage(0);
  const merged = buildMergedInboundPrepared({
    bindingKey: "scope-sender-a", workspaceRoot: "test-workspace",
    messages: [image], trailingPrepared: {
      senderId: "sender-a",
      text: "这两张是亲亲表情包",
      originalText: "这两张是亲亲表情包",
    },
  });
  assert.equal(merged.originalText, "这两张是亲亲表情包");
  assert.equal(merged.attachments.length, 1);
});
