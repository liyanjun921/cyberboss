const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { persistIncomingWeixinAttachments } = require("../src/adapters/channel/weixin/media-receive");

async function fixture(t) {
  const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cyberboss-media-test-"));
  const oldFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = oldFetch;
    await fsp.rm(stateDir, { recursive: true, force: true });
  });
  return { stateDir };
}
function image(index) {
  return {
    kind: "image",
    index,
    fileName: `image-${index}.gif`,
    directUrls: [`https://test.invalid/media/${index}`],
  };
}
function okGif(index) {
  return new Response(Buffer.from(`GIF89a-content-${index}`), {
    status: 200,
    headers: { "content-type": "image/gif" },
  });
}

test("media intake uses up to three workers and retains attachment order", async (t) => {
  const { stateDir } = await fixture(t);
  let active = 0;
  let highest = 0;
  globalThis.fetch = async (url) => {
    active += 1;
    highest = Math.max(highest, active);
    const index = Number(String(url).split("/").pop());
    await new Promise((resolve) => setTimeout(resolve, (4 - index) * 12));
    active -= 1;
    return okGif(index);
  };
  const result = await persistIncomingWeixinAttachments({
    attachments: [image(0), image(1), image(2), image(3)],
    stateDir,
    cdnBaseUrl: "https://test.invalid",
  });
  assert.equal(result.saved.length, 4);
  assert.equal(result.failed.length, 0);
  assert.ok(highest <= 3 && highest >= 2, `peak concurrency ${highest}`);
  assert.deepEqual(result.saved.map((item) => item.sourceFileName),
    ["image-0.gif", "image-1.gif", "image-2.gif", "image-3.gif"]);
});

test("transient HTTP 503 retries; permanent HTTP 404 does not retry", async (t) => {
  const { stateDir } = await fixture(t);
  const calls = new Map();
  globalThis.fetch = async (url) => {
    const key = String(url);
    const attempt = (calls.get(key) || 0) + 1;
    calls.set(key, attempt);
    if (key.endsWith("/0")) {
      return attempt === 1 ? new Response("unavailable", { status: 503 }) : okGif(0);
    }
    return new Response("missing", { status: 404 });
  };
  const result = await persistIncomingWeixinAttachments({
    attachments: [image(0), image(1)],
    stateDir,
    cdnBaseUrl: "https://test.invalid",
  });
  assert.equal(result.saved.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(calls.get("https://test.invalid/media/0"), 2);
  assert.equal(calls.get("https://test.invalid/media/1"), 1);
});

test("zero-byte and HTML responses are rejected without saving inbox files", async (t) => {
  const { stateDir } = await fixture(t);
  globalThis.fetch = async (url) => String(url).endsWith("/0")
    ? new Response(null, { status: 200 })
    : new Response("<html>bad</html>", { status: 200, headers: { "content-type": "text/html" } });
  const result = await persistIncomingWeixinAttachments({
    attachments: [image(0), image(1)],
    stateDir,
    cdnBaseUrl: "https://test.invalid",
  });
  assert.equal(result.saved.length, 0);
  assert.equal(result.failed.length, 2);
  await assert.rejects(fsp.stat(path.join(stateDir, "inbox")), { code: "ENOENT" });
});
