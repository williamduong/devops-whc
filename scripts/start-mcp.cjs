const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

const workspaceRoot = path.resolve(__dirname, "..");
const requestedEnvPath = process.env.WHC_ENV_FILE;
const projectRootHint = process.env.WHC_LOCAL_PROJECT_ROOT;

const envCandidates = [
  requestedEnvPath,
  projectRootHint ? path.join(projectRootHint, ".vscode", "whc.env") : undefined,
  projectRootHint ? path.join(projectRootHint, ".mcp", "whc-mcp", "env", "whc.env") : undefined,
  projectRootHint ? path.join(projectRootHint, ".mcp", "whc.env") : undefined,
  path.join(workspaceRoot, ".env"),
]
  .filter(Boolean)
  .map((p) => path.resolve(p));

const envFilePath = envCandidates.find((p) => fs.existsSync(p));

// Load .env manually before importing the compiled server
// (VS Code Copilot starts the process without any env pre-loaded)
if (envFilePath && fs.existsSync(envFilePath)) {
  const parsed = dotenv.parse(fs.readFileSync(envFilePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const serverEntryCandidates = [
  path.join(workspaceRoot, "dist", "server-entry.js"),
  path.join(workspaceRoot, "dist", "src", "server-entry.js"),
];

const serverEntry = serverEntryCandidates.find((p) => fs.existsSync(p));
if (!serverEntry) {
  throw new Error("MCP build output not found. Run npm run build before npm run mcp:start.");
}

require(serverEntry);
