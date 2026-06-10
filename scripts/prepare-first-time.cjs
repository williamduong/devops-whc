const fs = require("node:fs");
const path = require("node:path");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function ensureGitignoreRule(rootDir, rule) {
  const gitignorePath = path.join(rootDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${rule}\n`, "utf8");
    return;
  }

  const content = fs.readFileSync(gitignorePath, "utf8");
  const hasRule = content.split(/\r?\n/).some((line) => line.trim() === rule);
  if (hasRule) {
    return;
  }

  const next = content.endsWith("\n") ? `${content}${rule}\n` : `${content}\n${rule}\n`;
  fs.writeFileSync(gitignorePath, next, "utf8");
}

function ensureFileIfMissing(filePath, data) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, data, "utf8");
  }
}

function resolveStateRoot(rootDir) {
  const configured = (process.env.WHC_STATE_ROOT || "").trim();
  const relative = configured.length > 0 ? configured : ".mcp/whc-mcp";
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  return path.join(rootDir, ...segments);
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const stateRoot = resolveStateRoot(rootDir);
  const stateDir = path.join(stateRoot, "state");
  const releasesDir = path.join(stateDir, "releases");
  const reportsDir = path.join(stateDir, "reports");
  const logsDir = path.join(stateRoot, "logs");
  const envDir = path.join(stateRoot, "env");

  ensureDir(stateRoot);
  ensureDir(stateDir);
  ensureDir(releasesDir);
  ensureDir(reportsDir);
  ensureDir(logsDir);
  ensureDir(envDir);

  ensureGitignoreRule(rootDir, ".mcp/");

  const statusFile = path.join(stateDir, "pipeline-status.json");
  ensureFileIfMissing(
    statusFile,
    JSON.stringify(
      {
        started: false,
        completed: false,
        status: "idle",
        next_step: "Run a write tool (deploy/setup/backup/ssh) to start tracking.",
      },
      null,
      2,
    ) + "\n",
  );

  console.log("[prepare-first-time] Initialized .mcp/whc-mcp hidden state and ensured .gitignore contains .mcp/");
  console.log(`[prepare-first-time] State file: ${statusFile}`);
}

main();
