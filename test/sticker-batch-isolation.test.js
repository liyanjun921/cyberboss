const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StickerService } = require("../src/services/sticker-service");

async function makeFixture(t) {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-sticker-batch-test-"));
  t.after(async () => {
    await fsp.rm(stateDir, { recursive: true, force: true });
  });
  const inboxDir = path.join(stateDir, "inbox", "2026-10-31");
  await fsp.mkdir(inboxDir, { recursive: true });
  const normalizerPath = path.join(stateDir, "normalize-test.js");
  await fsp.writeFile(normalizerPath, [
    'const fs = require("fs");',
    'const args = process.argv.slice(2);',
    'const input = args[args.indexOf("--input") + 1];',
    'const output = args[args.indexOf("--output") + 1];',
    'fs.copyFileSync(input, output);',
  ].join("\n"), "utf8");
  const config = {
    stateDir,
    stickersDir: path.join(stateDir, "stickers"),
    stickerAssetsDir: path.join(stateDir, "stickers", "assets"),
    stickersIndexFile: path.join(stateDir, "stickers", "index.json"),
    stickerTagsFile: path.join(stateDir, "stickers", "tags.json"),
    stickersTemplateDir: path.join(stateDir, "absent-template"),
    stickerNormalizeGifScript: normalizerPath,
  };
  const service = new StickerService({ config });
  const notifications = [];
  service.sendContextText = async (message) => {
    notifications.push(message.text);
    return true;
  };
  return {
    config,
    service,
    notifications,
    async makeFile(name, content) {
      const p = path.join(inboxDir, name);
      await fsp.writeFile(p, content);
      return p;
    },
  };
}

test("saveFromInbox isolates one bad image, deduplicates and sends one summary", async (t) => {
  const { config, service, notifications, makeFile } = await makeFixture(t);
  const first = await makeFile("first.gif", "GIF89a-first");
  const duplicate = await makeFile("duplicate.gif", "GIF89a-first");
  const last = await makeFile("last.gif", "GIF89a-last");
  const result = await service.saveFromInbox({
    items: [
      { filePath: first, tags: ["happy"], desc: "first sticker sample" },
      { filePath: path.join(config.stateDir, "inbox", "missing.gif"), tags: ["bad"], desc: "missing file" },
      { filePath: duplicate, tags: ["happy"], desc: "duplicate sticker" },
      { filePath: last, tags: ["sleepy"], desc: "second sample sticker" },
    ],
  });

  assert.equal(result.createdCount, 2);
  assert.equal(result.dedupedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.results.length, 4);
  assert.equal(result.results[1].failed, true);
  const index = JSON.parse(await fsp.readFile(config.stickersIndexFile, "utf8"));
  assert.equal(Object.keys(index).length, 2);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /收到：4张/);
  assert.match(notifications[0], /保存：2张/);
  assert.match(notifications[0], /重复：1张/);
  assert.match(notifications[0], /失败：1张/);
});

test("saveFromInbox caps batches at ten images", async (t) => {
  const { service } = await makeFixture(t);
  await assert.rejects(service.saveFromInbox({ items: Array(11).fill({}) }), /1 to 10/);
});

test("saveFromInbox keeps saved batch when summary delivery fails", async (t) => {
  const { service, config, makeFile } = await makeFixture(t);
  const p = await makeFile("one.gif", "GIF89a-one");
  service.sendContextText = async () => { throw new Error("WeChat unavailable"); };
  const result = await service.saveFromInbox({
    items: [{ filePath: p, tags: ["test"], desc: "testing persistence" }],
  });
  assert.equal(result.createdCount, 1);
  const index = JSON.parse(await fsp.readFile(config.stickersIndexFile, "utf8"));
  assert.equal(Object.keys(index).length, 1);
});
