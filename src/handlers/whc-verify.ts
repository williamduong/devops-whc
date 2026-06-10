import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcSshClient } from "../clients/ssh-client";
import { runConnectivityProbe } from "../probes/connectivity";
import { WhcVerifyRequest } from "../schemas/whc-verify";
import { DEFAULT_STATE_ROOT, ensureWorkspaceState, getReleaseManifestFile, resolveStateRoot } from "../state/workspace-state";

export interface WhcVerifyData {
  release_id: string;
  final_status: "PASS" | "PARTIAL" | "FAIL";
  file_verification: {
    declared_changed_files: number;
    checked_files: number;
    missing_files: string[];
    sampled_files: string[];
    status: "PASS" | "PARTIAL" | "FAIL";
  };
  config_verification: {
    target_environment: "live" | "staging";
    target_path?: string;
    status: "PASS" | "PARTIAL" | "FAIL";
    notes: string[];
  };
  health_verification: {
    status: "PASS" | "PARTIAL" | "FAIL";
    details: string[];
  };
  db_verification?: {
    status: "PASS" | "PARTIAL" | "FAIL";
    details: string[];
  };
  notes: string[];
  report_file: string;
  next_step: string;
}

export interface WhcVerifyHandlerDeps {
  sshClient?: WhcSshClient;
  probeRunner?: typeof runConnectivityProbe;
  actionIdFactory?: () => string;
}

export async function executeWhcVerify(
  config: AppConfig,
  request: WhcVerifyRequest,
  deps: WhcVerifyHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcVerifyData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const sshClient = deps.sshClient ?? new WhcSshClient(config);
  const probeRunner = deps.probeRunner ?? runConnectivityProbe;

  const rootDir = process.cwd();
  ensureWorkspaceState(rootDir);

  const manifestSource = resolveManifest(rootDir, request.payload.release_id, request.payload.manifest_path);
  if (!manifestSource.manifest) {
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_verify",
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "No release manifest found. Run whc_deploy first or provide payload.manifest_path.",
        retryable: false,
      },
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "A",
        delivery_mechanism: "read_probe",
      },
    };
  }

  const releaseId = manifestSource.releaseId;
  const changedFiles = getChangedFiles(manifestSource.manifest);
  const sampleSize = Math.min(request.payload.random_sample_size ?? 10, changedFiles.length);
  const sampledFiles = sampleDeterministic(changedFiles, sampleSize, request.payload.random_seed ?? releaseId);
  const filesToCheck = uniqueStrings([...changedFiles, ...sampledFiles]);

  const targetBasePath = request.payload.target_environment === "staging"
    ? config.paths.staging ?? config.paths.prod
    : config.paths.prod;

  const missingFiles = await findMissingFilesOnTarget(sshClient, config, request.payload.target_environment, targetBasePath, filesToCheck);
  const fileStatus = deriveFileStatus(changedFiles.length, filesToCheck.length, missingFiles.length);

  const configNotes: string[] = [];
  if (!targetBasePath) {
    configNotes.push("Missing target path in config.");
  }
  if (request.payload.target_environment === "staging" && !config.paths.staging) {
    configNotes.push("WHC_STAGING_PATH is not set; fallback to production path was used.");
  }
  const configStatus = targetBasePath && configNotes.length === 0 ? "PASS" : targetBasePath ? "PARTIAL" : "FAIL";

  const health = await probeRunner(config);
  const healthDetails: string[] = [];
  if (!health.uapi.ok) healthDetails.push(`UAPI: ${health.uapi.message}`);
  if (!health.ssh.ok) healthDetails.push(`SSH: ${health.ssh.message}`);
  const healthStatus = healthDetails.length === 0 ? "PASS" : health.uapi.ok || health.ssh.ok ? "PARTIAL" : "FAIL";

  const shouldCheckDb = request.payload.verify_level === "with_db" || inferDataImpact(manifestSource.manifest);
  const dbVerification = shouldCheckDb
    ? await runDbVerification(sshClient, config, request.payload.target_environment, targetBasePath)
    : undefined;

  const finalStatus = deriveFinalStatus(fileStatus, configStatus, healthStatus, dbVerification?.status);
  const notes: string[] = [];
  if (missingFiles.length > 0) {
    notes.push(`Missing ${missingFiles.length} file(s) from manifest check.`);
  }
  if (!shouldCheckDb) {
    notes.push("DB verification skipped (no inferred data-impacting changes).",
    );
  }

  const stateRootRelative = (process.env.WHC_STATE_ROOT ?? DEFAULT_STATE_ROOT).trim() || DEFAULT_STATE_ROOT;
  const reportsDir = join(resolveStateRoot(rootDir), "state", "reports");
  const reportFile = join(reportsDir, `${releaseId}.verify-report.json`);

  const data: WhcVerifyData = {
    release_id: releaseId,
    final_status: finalStatus,
    file_verification: {
      declared_changed_files: changedFiles.length,
      checked_files: filesToCheck.length,
      missing_files: missingFiles,
      sampled_files: sampledFiles,
      status: fileStatus,
    },
    config_verification: {
      target_environment: request.payload.target_environment,
      target_path: targetBasePath,
      status: configStatus,
      notes: configNotes,
    },
    health_verification: {
      status: healthStatus,
      details: healthDetails,
    },
    db_verification: dbVerification,
    notes,
    report_file: reportFile,
    next_step: finalStatus === "PASS" ? "Verification passed. Continue pipeline." : "Inspect report and logs, then redeploy or rollback based on policy.",
  };

  writeFileSync(reportFile, JSON.stringify({
    ...data,
    manifest_source: manifestSource.path,
    state_root: stateRootRelative,
    verified_at: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");

  return {
    ok: true,
    action_id: actionIdFactory(),
    tool: "whc_verify",
    data,
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "A",
      release_intent: readReleaseIntent(manifestSource.manifest),
      delivery_mechanism: "read_probe",
    },
  };
}

function resolveManifest(rootDir: string, releaseId?: string, manifestPath?: string): {
  releaseId: string;
  path: string;
  manifest: Record<string, unknown> | null;
} {
  if (manifestPath) {
    if (!existsSync(manifestPath)) {
      return { releaseId: releaseId ?? "unknown", path: manifestPath, manifest: null };
    }
    return {
      releaseId: releaseId ?? extractReleaseId(manifestPath),
      path: manifestPath,
      manifest: parseJsonFile(manifestPath),
    };
  }

  if (releaseId) {
    const file = getReleaseManifestFile(rootDir, releaseId);
    return {
      releaseId,
      path: file,
      manifest: parseJsonFile(file),
    };
  }

  const releasesDir = join(resolveStateRoot(rootDir), "state", "releases");
  if (!existsSync(releasesDir)) {
    return { releaseId: "latest", path: releasesDir, manifest: null };
  }

  const candidates = readdirSync(releasesDir)
    .filter((name) => name.endsWith(".auto-manifest.json"))
    .map((name) => ({ name, fullPath: join(releasesDir, name), mtime: statSync(join(releasesDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const latest = candidates[0];
  if (!latest) {
    return { releaseId: "latest", path: releasesDir, manifest: null };
  }

  return {
    releaseId: extractReleaseId(latest.name),
    path: latest.fullPath,
    manifest: parseJsonFile(latest.fullPath),
  };
}

function parseJsonFile(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getChangedFiles(manifest: Record<string, unknown>): string[] {
  const value = manifest.changed_files;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sampleDeterministic(source: string[], sampleSize: number, seed: string): string[] {
  if (sampleSize <= 0) {
    return [];
  }

  const pool = [...source];
  const sampled: string[] = [];
  let state = seedToNumber(seed);

  while (pool.length > 0 && sampled.length < sampleSize) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const index = state % pool.length;
    sampled.push(pool[index]!);
    pool.splice(index, 1);
  }

  return sampled;
}

function seedToNumber(seed: string): number {
  let result = 2166136261;
  for (const ch of seed) {
    result ^= ch.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

async function findMissingFilesOnTarget(
  sshClient: WhcSshClient,
  config: AppConfig,
  targetEnvironment: "live" | "staging",
  targetBasePath: string | undefined,
  filesToCheck: string[],
): Promise<string[]> {
  if (!targetBasePath || filesToCheck.length === 0) {
    return [];
  }

  const quotedBase = quoteShell(targetBasePath);
  const checks = filesToCheck
    .map((file) => {
      const quotedRelative = quoteShell(file);
      return `[ -e ${quotedBase}/${quotedRelative} ] && echo OK:${file} || echo MISS:${file}`;
    })
    .join("; ");

  try {
    const result = await execOnTarget(sshClient, config, targetEnvironment, checks);
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("MISS:"))
      .map((line) => line.slice(5));
  } catch {
    return filesToCheck;
  }
}

async function runDbVerification(
  sshClient: WhcSshClient,
  config: AppConfig,
  targetEnvironment: "live" | "staging",
  targetBasePath: string | undefined,
): Promise<{ status: "PASS" | "PARTIAL" | "FAIL"; details: string[] }> {
  if (!targetBasePath) {
    return { status: "FAIL", details: ["Cannot run DB check because target path is missing."] };
  }

  const command = `cd ${quoteShell(targetBasePath)} && wp db check --quiet >/dev/null 2>&1 && echo DB_OK || echo DB_FAIL`;

  try {
    const result = await execOnTarget(sshClient, config, targetEnvironment, command);
    if (result.stdout.includes("DB_OK")) {
      return { status: "PASS", details: ["wp db check passed."] };
    }
    return { status: "FAIL", details: ["wp db check failed."] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "DB verification failed";
    return { status: "PARTIAL", details: [message] };
  }
}

async function execOnTarget(
  sshClient: WhcSshClient,
  config: AppConfig,
  targetEnvironment: "live" | "staging",
  command: string,
): Promise<{ stdout: string }> {
  if (targetEnvironment === "staging") {
    const target = config.sshTargets.staging;
    if (!target || !target.privateKeyPath) {
      throw new Error("Staging SSH target is not configured for key-based execution.");
    }
    const result = await sshClient.execWithKey(
      {
        host: target.host,
        port: target.port,
        username: target.username,
        privateKeyPath: target.privateKeyPath,
      },
      command,
    );

    if (!result.ok) {
      throw new Error(result.message || result.stderr || "SSH command failed");
    }

    return { stdout: result.stdout };
  }

  const result = await sshClient.execWithKey(config.sshTargets.prod, command);
  if (!result.ok) {
    throw new Error(result.message || result.stderr || "SSH command failed");
  }
  return { stdout: result.stdout };
}

function deriveFileStatus(declaredCount: number, checkedCount: number, missingCount: number): "PASS" | "PARTIAL" | "FAIL" {
  if (declaredCount === 0) {
    return "PARTIAL";
  }
  if (checkedCount === 0 || missingCount === checkedCount) {
    return "FAIL";
  }
  if (missingCount > 0) {
    return "PARTIAL";
  }
  return "PASS";
}

function deriveFinalStatus(
  fileStatus: "PASS" | "PARTIAL" | "FAIL",
  configStatus: "PASS" | "PARTIAL" | "FAIL",
  healthStatus: "PASS" | "PARTIAL" | "FAIL",
  dbStatus?: "PASS" | "PARTIAL" | "FAIL",
): "PASS" | "PARTIAL" | "FAIL" {
  const statuses = [fileStatus, configStatus, healthStatus, dbStatus].filter(Boolean) as Array<"PASS" | "PARTIAL" | "FAIL">;
  if (statuses.includes("FAIL")) {
    return "FAIL";
  }
  if (statuses.includes("PARTIAL")) {
    return "PARTIAL";
  }
  return "PASS";
}

function inferDataImpact(manifest: Record<string, unknown>): boolean {
  const releaseIntent = readReleaseIntent(manifest);
  return releaseIntent === "migrate" || releaseIntent === "recover";
}

function readReleaseIntent(manifest: Record<string, unknown>): "refresh" | "deploy" | "promote" | "migrate" | "recover" | undefined {
  const value = manifest.release_intent;
  if (value === "refresh" || value === "deploy" || value === "promote" || value === "migrate" || value === "recover") {
    return value;
  }
  return undefined;
}

function quoteShell(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

function extractReleaseId(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "release";
  return base.replace(/\.auto-manifest\.json$/, "").replace(/\.json$/, "");
}
