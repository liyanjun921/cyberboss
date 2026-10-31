const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validateOutboundFile } = require("../src/services/outbound-file-policy");

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-outbound-"));
  t.after(async () => fsp.rm(root, { recursive: true, force: true }));
  const config = {
    stateDir: path.join(root, "state"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const inside = path.join(config.stateDir, "stickers", "assets");
  const inbox = path.join(config.stateDir, "inbox");
  const exportsDir = path.join(config.workspaceRoot, "exports");
  const privateDir = path.join(config.workspaceRoot, "memory");
  await Promise.all([inside, inbox, exportsDir, privateDir].map((p) => fsp.mkdir(p, { recursive: true })));
  const make = async (p) => {
    await fsp.writeFile(p, "sample", "utf8");
    return p;
  };
  return { config, inside, inbox, exportsDir, privateDir, root, make };
}

test("outbound sending permits preapproved sticker, inbox, generated export files", async (t) => {
  const f = await fixture(t);
  for (const filename of [
    await f.make(path.join(f.inside, "hello.gif")),
    await f.make(path.join(f.inbox, "photo.png")),
    await f.make(path.join(f.exportsDir, "report.pdf")),
  ]) {
    assert.equal(validateOutboundFile(filename, f.config), fs.realpathSync(filename));
  }
});

test("outbound sending denies private memory, credentials and file path prefix tricks", async (t) => {
  const f = await fixture(t);
  const memory = await f.make(path.join(f.privateDir, "core.md"));
  const credentials = await f.make(path.join(f.exportsDir, "secret-token.txt"));
  const env = await f.make(path.join(f.exportsDir, ".env"));
  const privateDirLookalike = path.join(f.config.workspaceRoot, "exports-not-approved");
  await fsp.mkdir(privateDirLookalike, { recursive: true });
  const lookalike = await f.make(path.join(privateDirLookalike, "sample.pdf"));
  for (const filePath of [memory, credentials, env, lookalike]) {
    assert.throws(() => validateOutboundFile(filePath, f.config), /outside the approved|protected/);
  }
});

test("outbound sending denies symlinks pointing from export to private directory", async (t) => {
  const f = await fixture(t);
  const target = await f.make(path.join(f.privateDir, "personal.md"));
  const link = path.join(f.exportsDir, "shortcut.md");
  await fsp.symlink(target, link);
  assert.throws(() => validateOutboundFile(link, f.config), /outside the approved/);
});

test("outbound sending denies non-existent and directory paths", async (t) => {
  const f = await fixture(t);
  assert.throws(() => validateOutboundFile(path.join(f.inbox, "missing.png"), f.config), /not found/);
  assert.throws(() => validateOutboundFile(f.inbox, f.config), /regular file/);
});
