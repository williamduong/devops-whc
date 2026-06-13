import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export const DEFAULT_STATE_ROOT = ".whc";
const DEFAULT_BOOTSTRAP_ENV_FILE = "whc.env";
const DEFAULT_BOOTSTRAP_ENV_EXAMPLE_FILE = "whc.env.example";

type WriteTrackInput = {
  rootDir: string;
  toolName: string;
  requestId: string;
  targetEnvironment: string;
  pipelineId: string;
  releaseIntent: string;
  startedAtIso: string;
};

type WriteTrackResult = {
  ok: boolean;
  actionId: string;
  nextStep?: string;
  errorCode?: string;
  errorMessage?: string;
};

export function ensureWorkspaceState(rootDir = process.cwd()): void {
  const stateRoot = resolveStateRoot(rootDir);
  const stateDir = join(stateRoot, "state");
  const releasesDir = join(stateDir, "releases");
  const reportsDir = join(stateDir, "reports");
  const logsDir = join(stateRoot, "logs");
  const envDir = join(stateRoot, "env");

  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(releasesDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(envDir, { recursive: true });

  ensureGitignoreRule(rootDir, ".whc/");
}

export type WorkspaceBootstrapResult = {
  stateRootRelative: string;
  stateRootAbsolute: string;
  createdPaths: string[];
  gitignoreUpdated: boolean;
  pipelineStatusFile: string;
  envFile: string;
  envExampleFile: string;
};

export type WorkspaceBootstrapOptions = {
  localProjectRoot?: string;
  localAppPath?: string;
};

export function ensureWorkspaceBootstrap(
  rootDir = process.cwd(),
  options: WorkspaceBootstrapOptions = {},
): WorkspaceBootstrapResult {
  const stateRootAbsolute = resolveStateRoot(rootDir);
  const stateRootRelative = getRelativeStateRoot();
  const stateDir = join(stateRootAbsolute, "state");
  const releasesDir = join(stateDir, "releases");
  const reportsDir = join(stateDir, "reports");
  const logsDir = join(stateRootAbsolute, "logs");
  const envDir = join(stateRootAbsolute, "env");
  const trackedPaths = [
    stateRootAbsolute,
    stateDir,
    releasesDir,
    reportsDir,
    logsDir,
    envDir,
  ];
  const createdPaths: string[] = [];

  for (const dirPath of trackedPaths) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      createdPaths.push(dirPath);
    }
  }

  const gitignoreUpdated = ensureGitignoreRule(rootDir, ".whc/");
  const pipelineStatusFile = getPipelineStatusFile(rootDir);
  if (!existsSync(pipelineStatusFile)) {
    writeFileSync(
      pipelineStatusFile,
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
      { encoding: "utf8" },
    );
    createdPaths.push(pipelineStatusFile);
  }

  const envFile = join(envDir, DEFAULT_BOOTSTRAP_ENV_FILE);
  if (!existsSync(envFile)) {
    writeFileSync(envFile, buildBootstrapEnvTemplate(rootDir, options), { encoding: "utf8" });
    createdPaths.push(envFile);
  }

  const envExampleFile = join(envDir, DEFAULT_BOOTSTRAP_ENV_EXAMPLE_FILE);
  if (!existsSync(envExampleFile)) {
    writeFileSync(envExampleFile, buildBootstrapEnvTemplate(rootDir, options), { encoding: "utf8" });
    createdPaths.push(envExampleFile);
  }

  return {
    stateRootRelative,
    stateRootAbsolute,
    createdPaths,
    gitignoreUpdated,
    pipelineStatusFile,
    envFile,
    envExampleFile,
  };
}

export function writePipelineStartState(input: WriteTrackInput): void {
  ensureWorkspaceState(input.rootDir);
  const stateFile = getPipelineStatusFile(input.rootDir);
  const payload = {
    started: true,
    completed: false,
    status: "in_progress",
    tool: input.toolName,
    request_id: input.requestId,
    target_environment: input.targetEnvironment,
    pipeline_id: input.pipelineId,
    release_intent: input.releaseIntent,
    started_at: input.startedAtIso,
    next_step: "Wait for tool execution result.",
  };
  writeFileSync(stateFile, JSON.stringify(payload, null, 2), { encoding: "utf8" });
}

export function writePipelineEndState(input: WriteTrackInput, result: WriteTrackResult): void {
  ensureWorkspaceState(input.rootDir);
  const stateFile = getPipelineStatusFile(input.rootDir);
  const completedAtIso = new Date().toISOString();

  const payload = {
    started: true,
    completed: true,
    status: result.ok ? "success" : "failure",
    tool: input.toolName,
    request_id: input.requestId,
    action_id: result.actionId,
    target_environment: input.targetEnvironment,
    pipeline_id: input.pipelineId,
    release_intent: input.releaseIntent,
    started_at: input.startedAtIso,
    completed_at: completedAtIso,
    next_step: result.nextStep ?? defaultNextStep(result.ok),
    error: result.ok
      ? null
      : {
          code: result.errorCode ?? "UNKNOWN",
          message: result.errorMessage ?? "Unknown error",
        },
  };

  writeFileSync(stateFile, JSON.stringify(payload, null, 2), { encoding: "utf8" });
  writeAutoManifest(input, completedAtIso, result.ok);
}

function writeAutoManifest(input: WriteTrackInput, completedAtIso: string, ok: boolean): void {
  const releaseFile = getReleaseManifestFile(input.rootDir, input.requestId);
  const changedFiles = collectGitChangedFiles(input.rootDir);
  const payload = {
    request_id: input.requestId,
    tool: input.toolName,
    target_environment: input.targetEnvironment,
    pipeline_id: input.pipelineId,
    release_intent: input.releaseIntent,
    started_at: input.startedAtIso,
    completed_at: completedAtIso,
    status: ok ? "success" : "failure",
    changed_files: changedFiles,
  };
  writeFileSync(releaseFile, JSON.stringify(payload, null, 2), { encoding: "utf8" });
}

function collectGitChangedFiles(rootDir: string): string[] {
  try {
    const output = execSync("git status --porcelain", { cwd: rootDir, stdio: ["ignore", "pipe", "ignore"] })
      .toString("utf8")
      .trim();
    if (!output) {
      return [];
    }

    return output
      .split(/\r?\n/)
      .map((line) => line.slice(3).trim())
      .filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

function ensureGitignoreRule(rootDir: string, rule: string): boolean {
  const gitignorePath = join(rootDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${rule}\n`, { encoding: "utf8" });
    return true;
  }

  const content = readFileSync(gitignorePath, "utf8");
  const hasRule = content.split(/\r?\n/).some((line) => line.trim() === rule);
  if (hasRule) {
    return false;
  }

  const next = content.endsWith("\n") ? `${content}${rule}\n` : `${content}\n${rule}\n`;
  writeFileSync(gitignorePath, next, { encoding: "utf8" });
  return true;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function defaultNextStep(ok: boolean): string {
  if (ok) {
    return "Proceed to next pipeline step based on policy and verification scope.";
  }
  return "Inspect .whc/logs/flow-events.jsonl and retry after fixing the reported error.";
}

export function resolveStateRoot(rootDir = process.cwd()): string {
  const configuredOrDefault = getRelativeStateRoot();
  if (isAbsolute(configuredOrDefault)) {
    return configuredOrDefault;
  }
  const segments = configuredOrDefault.split(/[\\/]+/).filter((part) => part.length > 0);
  return join(rootDir, ...segments);
}

function getRelativeStateRoot(): string {
  const configured = (process.env.WHC_STATE_ROOT ?? "").trim();
  return configured.length > 0 ? configured : DEFAULT_STATE_ROOT;
}

function buildBootstrapEnvTemplate(rootDir: string, options: WorkspaceBootstrapOptions): string {
  return [
    "# Project-local WHC bootstrap env",
    "# Fill the values needed for this specific deploy workspace.",
    `WHC_LOCAL_PROJECT_ROOT=${options.localProjectRoot ?? rootDir}`,
    `WHC_LOCAL_APP_PATH=${options.localAppPath ?? ""}`,
    "WHC_WORKFLOW_MODE=",
    "WHC_SOURCE_KIND=full_site",
    "WHC_DEPLOY_UNIT=raw_source",
    "WHC_DEFAULT_RELEASE_INTENT=deploy",
    "",
    "# Managed WHC mode",
    "WHC_API_TOKEN=",
    "WHC_USER=",
    "WHC_HOST=",
    "WHC_PROD_PATH=/public_html",
    "WHC_PROD_SSH_HOST=",
    "WHC_PROD_SSH_PORT=27",
    "WHC_PROD_SSH_USERNAME=",
    "WHC_PROD_SSH_PRIVATE_KEY_PATH=",
    "",
    "# Staging/source-driven mode",
    "WHC_STAGING_DOMAIN=",
    "WHC_STAGING_PATH=",
    "WHC_STAGING_SSH_HOST=",
    "WHC_STAGING_SSH_PORT=27",
    "WHC_STAGING_SSH_USERNAME=",
    "WHC_STAGING_SSH_PRIVATE_KEY_PATH=",
    "WHC_STAGING_SSH_PASSWORD=",
    "WHC_STAGING_SSH_HOSTKEY=",
    "",
    "WHC_REQUIRE_STAGING_CONFIRM=true",
    "WHC_WARN_DYNAMIC_DATA_SYNC=true",
    "WHC_ENFORCE_STAGING_FIRST=true",
    "WHC_API_TIMEOUT_MS=15000",
    "WHC_SSH_TIMEOUT_MS=10000",
    "",
  ].join("\n");
}

export function getPipelineStatusFile(rootDir = process.cwd()): string {
  return join(resolveStateRoot(rootDir), "state", "pipeline-status.json");
}

export function getReleaseManifestFile(rootDir: string, requestId: string): string {
  return join(resolveStateRoot(rootDir), "state", "releases", `${safeFileName(requestId)}.auto-manifest.json`);
}

export function readPipelineStatus(rootDir = process.cwd()): Record<string, unknown> | null {
  const statusFile = getPipelineStatusFile(rootDir);
  if (!existsSync(statusFile)) {
    return null;
  }

  try {
    const raw = readFileSync(statusFile, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readReleaseManifest(rootDir: string, requestId: string): Record<string, unknown> | null {
  const file = getReleaseManifestFile(rootDir, requestId);
  if (!existsSync(file)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getVerifyReportFile(rootDir: string, releaseId: string): string {
  return join(resolveStateRoot(rootDir), "state", "reports", `${safeFileName(releaseId)}.verify-report.json`);
}

export function findLatestVerifyReportFile(rootDir = process.cwd()): string | null {
  const reportsDir = join(resolveStateRoot(rootDir), "state", "reports");
  if (!existsSync(reportsDir)) {
    return null;
  }

  const files = readdirSync(reportsDir)
    .filter((name) => name.endsWith(".verify-report.json"))
    .map((name) => {
      const fullPath = join(reportsDir, name);
      return { fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return files[0]?.fullPath ?? null;
}

export function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
