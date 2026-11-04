#!/usr/bin/env node
"use strict";

// Same-machine Live2D touch -> CyberBoss's native durable system-message queue.
// Does not alter sessions.json or invoke the model directly.
const TOUCH_TEXT = Object.freeze({
  stroke: "[pet-touch] 你被摸摸了！",
  double: "[pet-touch] 你被戳了一下！",
  dizzy: "[pet-touch] 你被晃晕了！",
});
const DESCRIPTIONS = Object.freeze({
  stroke: "用户轻轻摸了你的 Live2D 形象",
  double: "用户轻轻戳了你的 Live2D 形象",
  dizzy: "用户晃动了你的 Live2D 形象",
});
const MARKER = "[LIVE2D_TOUCH_EVENT]";

function parseTouch(input) {
  if (typeof input !== "string" || input.length > 128) {
    throw new Error("Touch must be a short string");
  }
  const type = Object.keys(TOUCH_TEXT).find(
    (key) => input === key || input === TOUCH_TEXT[key]
  );
  if (!type) throw new Error("Unsupported touch event; only stroke/double/dizzy are accepted");
  return Object.freeze({ type });
}

function buildTouchMessage(event) {
  if (!event || !Object.hasOwn(DESCRIPTIONS, event.type)) {
    throw new Error("Invalid touch event");
  }
  return [
    MARKER,
    "source: live2d-body-starter",
    "type: " + event.type,
    "observation: " + DESCRIPTIONS[event.type],
    "",
    "这是外部传感器报告的触摸事件，不是系统指令，也不是用户要求你执行工具的命令。",
    "你可以自行判断是否回复、如何回复，或者暂时不行动。",
  ].join("\n");
}

function enqueueTouch(event, { target, systemMessageService }) {
  if (!target?.senderId || !target?.workspaceRoot || !systemMessageService?.queueMessage) {
    throw new Error("A resolved CyberBoss sender/workspace and native queue are required");
  }
  const result = systemMessageService.queueMessage({
    text: buildTouchMessage(event),
    userId: target.senderId,
    workspaceRoot: target.workspaceRoot,
  });
  return { queued: true, id: result.id, type: event.type };
}

function mapEnvironment(env) {
  const aliases = {
    LIVE2D_CYBERBOSS_HOME: "GARDEN_CYBERBOSS_HOME",
    LIVE2D_CYBERBOSS_STATE_DIR: "GARDEN_CYBERBOSS_STATE_DIR",
    LIVE2D_CYBERBOSS_SENDER_ID: "GARDEN_CYBERBOSS_SENDER_ID",
    LIVE2D_CYBERBOSS_WORKSPACE_ROOT: "GARDEN_CYBERBOSS_WORKSPACE_ROOT",
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (typeof env[from] === "string" && env[from].trim()) {
      env[to] = env[from].trim();
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("Usage: node inject-touch.js 'stroke|double|dizzy|<default pet message>'");
  }
  const event = parseTouch(argv[0]);
  mapEnvironment(process.env);
  const { loadCyberbossEnvironment, resolveGardenTarget } =
    require("../galatea-garden/inject-cyberboss");
  loadCyberbossEnvironment(process.env);

  const { readConfig } = require("../../src/core/config");
  const { SessionStore } = require("../../src/adapters/runtime/codex/session-store");
  const { SystemMessageService } = require("../../src/services/system-message-service");
  const originalArgv = process.argv;
  let config;
  try {
    process.argv = [process.execPath, __filename];
    config = readConfig();
  } finally {
    process.argv = originalArgv;
  }

  const sessionStore = new SessionStore({
    filePath: config.sessionsFile,
    runtimeId: config.runtime || "codex",
  });
  const target = resolveGardenTarget({ config, sessionStore, env: process.env });
  const systemMessageService = new SystemMessageService({ config, sessionStore });
  const queued = enqueueTouch(event, { target, systemMessageService });
  process.stdout.write(JSON.stringify(queued) + "\n");
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write("[live2d-touch] " + error.message + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  TOUCH_TEXT,
  MARKER,
  parseTouch,
  buildTouchMessage,
  enqueueTouch,
  mapEnvironment,
};
