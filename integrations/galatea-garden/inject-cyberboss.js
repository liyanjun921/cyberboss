#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const CYBERBOSS_ROOT = path.resolve(__dirname, "..", "..");
const GARDEN_WAKE_MARKER = "[GARDEN_WAKE_EVENT]";
const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_REASON_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 4096;

async function readEnvelope(stream = process.stdin) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_ENVELOPE_BYTES) {
      throw new Error("Garden wake envelope exceeds the 16 KiB limit");
    }
    chunks.push(buffer);
  }

  if (!totalBytes) {
    throw new Error("Garden wake envelope is empty");
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Garden wake envelope is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Garden wake envelope must be a JSON object");
  }
  if (parsed.version !== 1 || parsed.type !== "garden_wake") {
    throw new Error("Unsupported Garden wake envelope version or type");
  }

  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  const message = typeof parsed.message === "string" ? parsed.message : "";
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    throw new Error("Garden wake envelope has an invalid reason");
  }
  if (!message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Garden wake envelope has an invalid message");
  }

  return { version: 1, type: "garden_wake", reason, message };
}

function loadCyberbossEnvironment(env = process.env) {
  const homeValue = normalizeText(env.GARDEN_CYBERBOSS_HOME)
    || normalizeText(env.CYBERBOSS_HOME)
    || CYBERBOSS_ROOT;
  const cyberbossHome = path.resolve(homeValue);

  if (!fs.existsSync(path.join(cyberbossHome, "src", "core", "config.js"))
    || !fs.existsSync(path.join(cyberbossHome, "package.json"))) {
    throw new Error("Cyberboss source directory is invalid; set GARDEN_CYBERBOSS_HOME");
  }

  env.CYBERBOSS_HOME = cyberbossHome;
  if (normalizeText(env.GARDEN_CYBERBOSS_STATE_DIR)) {
    env.CYBERBOSS_STATE_DIR = path.resolve(env.GARDEN_CYBERBOSS_STATE_DIR);
  }

  const candidates = [
    path.join(cyberbossHome, ".env"),
    normalizeText(env.CYBERBOSS_STATE_DIR) ? path.join(env.CYBERBOSS_STATE_DIR, ".env") : "",
    path.join(os.homedir(), ".cyberboss", ".env"),
  ].filter(Boolean);

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }

  const stateDir = normalizeText(env.CYBERBOSS_STATE_DIR);
  if (!stateDir) {
    throw new Error("Set GARDEN_CYBERBOSS_STATE_DIR or CYBERBOSS_STATE_DIR to the existing Cyberboss state directory");
  }
  if (!path.isAbsolute(stateDir)) {
    throw new Error("Cyberboss state directory must be an absolute path");
  }
  if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) {
    throw new Error("Configured Cyberboss state directory does not exist");
  }

  env.CYBERBOSS_STATE_DIR = path.resolve(stateDir);
  return { cyberbossHome, stateDir: path.resolve(stateDir) };
}

function resolveGardenTarget({ config, sessionStore, env = process.env }) {
  const { resolveSelectedAccount } = require("../../src/adapters/channel/weixin/account-store");
  const { resolvePreferredSenderId } = require("../../src/core/default-targets");

  const account = resolveSelectedAccount(config);
  const explicitSenderId = normalizeText(env.GARDEN_CYBERBOSS_SENDER_ID);
  const allowedUserIds = Array.isArray(config.allowedUserIds)
    ? config.allowedUserIds.map(normalizeText).filter(Boolean)
    : [];

  if (allowedUserIds.length > 1 && !explicitSenderId) {
    throw new Error("Multiple allowed WeChat users exist; set GARDEN_CYBERBOSS_SENDER_ID explicitly");
  }

  const senderId = explicitSenderId || resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    sessionStore,
  });
  if (!senderId) {
    throw new Error("Could not resolve one Cyberboss WeChat sender");
  }
  if (allowedUserIds.length && !allowedUserIds.includes(senderId)) {
    throw new Error("Garden target sender is not in CYBERBOSS_ALLOWED_USER_IDS");
  }

  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: config.workspaceId,
    accountId: account.accountId,
    senderId,
  });
  const binding = sessionStore.getBinding(bindingKey) || {};
  const explicitWorkspaceRoot = normalizeText(env.GARDEN_CYBERBOSS_WORKSPACE_ROOT);
  const activeWorkspaceRoot = normalizeText(sessionStore.getActiveWorkspaceRoot(bindingKey));
  const boundWorkspaceRoots = collectWorkspaceRoots(binding, config.runtime);
  const configuredWorkspaceRoot = normalizeText(env.CYBERBOSS_WORKSPACE_ROOT)
    ? normalizeText(config.workspaceRoot)
    : "";

  const workspaceRoot = explicitWorkspaceRoot
    || activeWorkspaceRoot
    || (boundWorkspaceRoots.length === 1 ? boundWorkspaceRoots[0] : "")
    || configuredWorkspaceRoot;

  if (!workspaceRoot) {
    throw new Error("Could not resolve one bound workspace; set GARDEN_CYBERBOSS_WORKSPACE_ROOT explicitly");
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("Garden target workspace must be an absolute path");
  }

  let stats;
  try {
    stats = fs.statSync(workspaceRoot);
  } catch {
    throw new Error("Garden target workspace does not exist");
  }
  if (!stats.isDirectory()) {
    throw new Error("Garden target workspace is not a directory");
  }

  return {
    accountId: account.accountId,
    senderId,
    workspaceRoot: path.resolve(workspaceRoot),
    bindingKey,
  };
}

function collectWorkspaceRoots(binding, runtimeId = "codex") {
  const roots = new Set();
  const normalizedRuntimeId = normalizeText(runtimeId) || "codex";
  const runtimeMap = binding?.threadIdByWorkspaceRootByRuntime?.[normalizedRuntimeId];
  if (runtimeMap && typeof runtimeMap === "object") {
    for (const root of Object.keys(runtimeMap)) {
      if (normalizeText(root)) roots.add(normalizeText(root));
    }
  }
  if (normalizedRuntimeId === "codex") {
    for (const root of Object.keys(binding?.threadIdByWorkspaceRoot || {})) {
      if (normalizeText(root)) roots.add(normalizeText(root));
    }
    for (const root of Object.keys(binding?.codexParamsByWorkspaceRoot || {})) {
      if (normalizeText(root)) roots.add(normalizeText(root));
    }
  }
  const active = normalizeText(binding?.activeWorkspaceRoot);
  if (active) roots.add(active);
  return Array.from(roots).sort();
}

function buildGardenTriggerText(envelope) {
  return [
    GARDEN_WAKE_MARKER,
    "reason: " + envelope.reason,
    "",
    envelope.message,
  ].join("\n");
}

function enqueueGardenWake(envelope, {
  config,
  sessionStore,
  systemMessageService,
  env = process.env,
} = {}) {
  if (!config || !sessionStore || !systemMessageService) {
    throw new Error("Garden injector is missing Cyberboss services");
  }

  const target = resolveGardenTarget({ config, sessionStore, env });
  const queued = systemMessageService.queueMessage({
    text: buildGardenTriggerText(envelope),
    userId: target.senderId,
    workspaceRoot: target.workspaceRoot,
  });

  return {
    id: queued.id,
    reason: envelope.reason,
    accountId: target.accountId,
    senderId: target.senderId,
    workspaceRoot: target.workspaceRoot,
  };
}

async function main() {
  const envelope = await readEnvelope();
  loadCyberbossEnvironment(process.env);

  const { readConfig } = require("../../src/core/config");
  const { SessionStore } = require("../../src/adapters/runtime/codex/session-store");
  const { SystemMessageService } = require("../../src/services/system-message-service");

  const config = readConfig();
  const sessionStore = new SessionStore({
    filePath: config.sessionsFile,
    runtimeId: config.runtime || "codex",
  });
  const systemMessageService = new SystemMessageService({ config, sessionStore });
  const queued = enqueueGardenWake(envelope, {
    config,
    sessionStore,
    systemMessageService,
    env: process.env,
  });

  process.stdout.write(JSON.stringify({
    ok: true,
    queued: true,
    id: queued.id,
    reason: queued.reason,
  }) + "\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    process.stderr.write("[garden-cyberboss-injector] " + message + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  GARDEN_WAKE_MARKER,
  buildGardenTriggerText,
  collectWorkspaceRoots,
  enqueueGardenWake,
  loadCyberbossEnvironment,
  readEnvelope,
  resolveGardenTarget,
};
