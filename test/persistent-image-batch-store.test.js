const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PersistentImageBatchStore } = require("../src/core/persistent-image-batch-store");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-image-batches-"));
  t.after(async () => fsp.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "pending-image-batches.json");
  return { store: new PersistentImageBatchStore({ filePath }), filePath };
}
test("debounced image batch survives application restart and timer is not serialized", async (t) => {
  const { store, filePath } = await fixture(t);
  const batches = new Map([
    ["scope-1", {
      bindingKey: "binding-1", workspaceRoot: "/test",
      messages: [{ text: "", attachments: [{ sourceFileName: "one.gif" }] }],
      timer: { shouldNotPersist: true },
    }],
  ]);
  store.save(batches);
  const restored = new PersistentImageBatchStore({ filePath }).load();
  assert.equal(restored.length, 1);
  assert.equal(restored[0][1].messages[0].attachments[0].sourceFileName, "one.gif");
  assert.equal(restored[0][1].timer, null);
  assert.ok(!fs.readFileSync(filePath, "utf8").includes("shouldNotPersist"));
});
test("empty image batch store records safe empty snapshot", async (t) => {
  const { store } = await fixture(t);
  store.save(new Map());
  assert.deepEqual(store.load(), []);
});
test("corrupt image batch storage fails closed instead of dropping images", async (t) => {
  const { store, filePath } = await fixture(t);
  await fsp.writeFile(filePath, "{broken", "utf8");
  assert.throws(() => store.load(), /refusing to discard pending media/);
});
