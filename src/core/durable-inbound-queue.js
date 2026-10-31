const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MAX_PENDING = 500;
const MAX_ACKED_IDS = 5000;

function recordKey(raw) {
  const id = [raw?.msg_id, raw?.message_id, raw?.msgId, raw?.id]
    .map((value) => String(value ?? "").trim()).find(Boolean);
  const scope = String(raw?.from_user_id || raw?.fromUserId || "");
  if (id) {
    return crypto.createHash("sha256").update(scope + ":" + id).digest("hex");
  }
  return crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex");
}

class DurableInboundQueue {
  constructor({ filePath, maxPending = DEFAULT_MAX_PENDING }) {
    this.filePath = path.resolve(filePath);
    this.maxPending = maxPending;
    this.state = { version: 1, pending: [], acknowledged: [] };
    if (fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (parsed?.version !== 1 || !Array.isArray(parsed.pending) || !Array.isArray(parsed.acknowledged)) {
          throw new Error("invalid spool schema");
        }
        this.state = parsed;
      } catch (error) {
        // Fail closed. Never discard a queue that may contain unprocessed WeChat messages.
        throw new Error("Cannot load persisted inbound spool; refusing to advance WeChat checkpoint: " + error.message);
      }
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(5).toString("hex");
    try {
      fs.writeFileSync(temp, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    }
  }

  enqueueBatch(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    const seen = new Set([
      ...this.state.acknowledged,
      ...this.state.pending.map((entry) => entry.key),
    ]);
    const next = [];
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const key = recordKey(message);
      if (!seen.has(key)) {
        seen.add(key);
        next.push({ key, raw: message, receivedAt: new Date().toISOString() });
      }
    }
    if (this.state.pending.length + next.length > this.maxPending) {
      throw new Error(
        "Inbound spool full: " + this.state.pending.length +
        " pending, " + next.length + " new; checkpoint not advanced."
      );
    }
    if (!next.length) return 0;
    const old = this.state;
    this.state = { ...this.state, pending: [...this.state.pending, ...next] };
    try {
      this.persist();
    } catch (error) {
      this.state = old;
      throw error;
    }
    return next.length;
  }

  peek() {
    return this.state.pending[0] || null;
  }

  ack(key) {
    const first = this.state.pending[0];
    if (!first || first.key !== key) {
      throw new Error("Inbound queue ack requires the oldest pending message");
    }
    const old = this.state;
    this.state = {
      ...this.state,
      pending: this.state.pending.slice(1),
      acknowledged: [...this.state.acknowledged, key].slice(-MAX_ACKED_IDS),
    };
    try {
      this.persist();
    } catch (error) {
      this.state = old;
      throw error;
    }
  }

  get pendingCount() {
    return this.state.pending.length;
  }
}

module.exports = { DurableInboundQueue, recordKey };
