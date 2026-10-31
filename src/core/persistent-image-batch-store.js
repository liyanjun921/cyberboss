const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class PersistentImageBatchStore {
  constructor({ filePath }) {
    this.filePath = path.resolve(filePath);
  }

  load() {
    if (!fs.existsSync(this.filePath)) return [];
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      throw new Error("Cannot load saved image batches; refusing to discard pending media: " + error.message);
    }
    if (data?.version !== 1 || !Array.isArray(data.batches)) {
      throw new Error("Saved image batch storage has invalid schema");
    }
    return data.batches.map((entry) => {
      if (!entry.scopeKey || !entry.bindingKey || !entry.workspaceRoot || !Array.isArray(entry.messages)) {
        throw new Error("Saved image batch entry is invalid");
      }
      return [entry.scopeKey, {
        bindingKey: entry.bindingKey,
        workspaceRoot: entry.workspaceRoot,
        messages: entry.messages,
        timer: null,
      }];
    });
  }

  save(batches) {
    const body = {
      version: 1,
      batches: [...batches.entries()].filter(([, value]) => value?.messages?.length).map(([scopeKey, value]) => ({
        scopeKey,
        bindingKey: value.bindingKey,
        workspaceRoot: value.workspaceRoot,
        messages: value.messages,
      })),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
    try {
      fs.writeFileSync(temp, JSON.stringify(body), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    }
  }
}

module.exports = { PersistentImageBatchStore };
