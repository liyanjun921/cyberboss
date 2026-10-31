const fs = require("node:fs");
const path = require("node:path");

const BLOCKED_FILE_NAMES = [
  /^\.env(?:\..*)?$/i,
  /(?:^|[._-])(?:token|secret|password|credential|private[._-]?key)(?:[._-]|$)/i,
  /\.(?:pem|key|p12|pfx|kdbx|sqlite|db)$/i,
];

function permittedFileRoots(config = {}) {
  const stateDir = path.resolve(String(config.stateDir || "."));
  const workspaceRoot = path.resolve(String(config.workspaceRoot || "."));
  return [
    path.join(stateDir, "stickers", "assets"),
    path.join(stateDir, "inbox"),
    path.join(workspaceRoot, "exports"),
    path.join(workspaceRoot, "out"),
    path.join(workspaceRoot, "generated"),
  ];
}

function realContainedPath(root, filePath) {
  if (!fs.existsSync(root)) return false;
  const realRoot = fs.realpathSync(root);
  const rel = path.relative(realRoot, filePath);
  return rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

function validateOutboundFile(filePath, config = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Missing file path to send.");
  }
  const requested = path.resolve(filePath.trim());
  let realPath;
  try {
    realPath = fs.realpathSync(requested);
  } catch {
    throw new Error("Outbound file was not found.");
  }
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) {
    throw new Error("Outbound path must be a regular file.");
  }
  if (BLOCKED_FILE_NAMES.some((pattern) => pattern.test(path.basename(realPath)))) {
    throw new Error("Outbound file has a protected name or extension.");
  }
  // Use the canonical real path to defeat links escaping an approved directory.
  if (!permittedFileRoots(config).some((root) => realContainedPath(root, realPath))) {
    throw new Error(
      "Outbound file is outside the approved send directories (stickers/assets, inbox, exports, out, generated)."
    );
  }
  return realPath;
}

module.exports = { permittedFileRoots, validateOutboundFile };
