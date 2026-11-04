#!/usr/bin/env node
"use strict";

// A deliberately narrow client of the original starter's local body API.
// No arbitrary URLs, commands, or headers can be supplied by an AI.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const EMOTIONS = new Set(["happy", "love", "shy", "sad", "angry", "gloomy", "neutral"]);
const ACTIONS = new Set(["nod", "shake", "surprise", "thinking", "shy", "celebrate"]);

function makeRequest(command, value) {
  if (command === "status" && value === undefined) {
    return { method: "GET", path: "/emotion" };
  }
  if (command === "emotion" && EMOTIONS.has(value)) {
    return { method: "POST", path: "/emotion", body: { emotion: value } };
  }
  if (command === "action" && ACTIONS.has(value)) {
    return { method: "POST", path: "/choreograph", body: { action: value } };
  }
  if (command === "say" && typeof value === "string" && value.trim()
      && value.length <= 600 && !/[<>]/.test(value)) {
    return { method: "POST", path: "/speak", body: { text: value } };
  }
  if (command === "bubble" && typeof value === "string" && value.trim()
      && value.length <= 600) {
    return { method: "POST", path: "/chat", body: { sender: "pet", text: value } };
  }
  throw new Error("Usage: pet-cli.js status | emotion <known emotion> | action <known action> | say <text> | bubble <text>");
}

function getPetSettings(env = process.env) {
  const root = env.LIVE2D_PET_ROOT;
  if (!root || !path.isAbsolute(root)) {
    throw new Error("LIVE2D_PET_ROOT must point to the starter checkout (absolute path)");
  }
  const token = fs.readFileSync(path.join(root, ".pet-token"), "utf8").trim();
  if (token.length < 12) throw new Error("Invalid/missing .pet-token");
  const port = env.LIVE2D_PET_PORT ? Number(env.LIVE2D_PET_PORT) : 3470;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid local pet port");
  }
  return { token, port };
}

function sendToPet(request, { token, port }) {
  return new Promise((resolve, reject) => {
    const data = request.body ? JSON.stringify(request.body) : "";
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: request.path,
      method: request.method,
      headers: {
        "X-Pet-Token": token,
        ...(data ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        } : {}),
      },
      timeout: request.path === "/speak" ? 35000 : 3000,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 65536) {
          req.destroy(new Error("Pet response too large"));
        } else {
          chunks.push(chunk);
        }
      });
      res.on("end", () => {
        const response = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error("Pet API HTTP " + res.statusCode + ": " + response.slice(0, 300)));
        } else {
          resolve({ ok: true, httpStatus: res.statusCode, response: response.slice(0, 3000) });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Pet API timeout")));
    req.on("error", reject);
    req.end(data);
  });
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const request = makeRequest(command, args.length ? args.join(" ") : undefined);
  const result = await sendToPet(request, getPetSettings());
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write("[live2d-body] " + error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = { makeRequest, getPetSettings, sendToPet };
