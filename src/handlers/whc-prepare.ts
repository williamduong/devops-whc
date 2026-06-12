import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcPrepareRequest } from "../schemas/whc-prepare";
import { DEFAULT_STATE_ROOT, ensureWorkspaceState, getPipelineStatusFile, resolveStateRoot } from "../state/workspace-state";

export interface WhcPrepareData {
  state_root: string;
  created_paths: string[];
  gitignore_updated: boolean;
  already_initialized: boolean;
  ready: boolean;
  manual_actions: string[];
  checks: Array<{
    name: string;
    status: "pass" | "fail";
    details: string;
  }>;
  pipeline_status_file: string;
  next_step: string;
}

export async function executeWhcPrepare(
  _config: AppConfig,
  request: WhcPrepareRequest,
): Promise<ToolResponseEnvelope<WhcPrepareData>> {
  const startedAt = Date.now();
  const rootDir = request.payload.workspace_root ?? process.cwd();
  const relativeStateRoot = (process.env.WHC_STATE_ROOT ?? DEFAULT_STATE_ROOT).trim() || DEFAULT_STATE_ROOT;
  const stateRootAbs = resolveStateRoot(rootDir);
  const pipelineStatusFile = getPipelineStatusFile(rootDir);

  const trackedPaths = [
    relativeStateRoot,
    `${relativeStateRoot}/state`,
    `${relativeStateRoot}/state/releases`,
    `${relativeStateRoot}/state/reports`,
    `${relativeStateRoot}/logs`,
    `${relativeStateRoot}/env`,
  ];

  const existingBefore = new Set(
    trackedPaths.filter((relativePath) => existsSync(join(rootDir, ...relativePath.split("/").filter(Boolean)))),
  );
  const hadStatusBefore = existsSync(pipelineStatusFile);

  if (request.dry_run) {
    const checks = buildChecks();
    const manualActions = checks.filter((item) => item.status === "fail").map((item) => item.details);

    return {
      ok: true,
      action_id: randomUUID(),
      tool: "whc_prepare",
      data: {
        state_root: relativeStateRoot,
        created_paths: trackedPaths.filter((item) => !existingBefore.has(item)),
        gitignore_updated: false,
        already_initialized: hadStatusBefore,
        ready: manualActions.length === 0,
        manual_actions: manualActions,
        checks,
        pipeline_status_file: pipelineStatusFile,
        next_step: "Set dry_run=false to materialize state files and continue to whc_deploy.",
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "B",
        delivery_mechanism: "file_transfer",
      },
    };
  }

  ensureWorkspaceState(rootDir);
  const gitignoreUpdated = request.payload.ensure_gitignore_rule !== false
    ? ensureGitignoreRule(rootDir, ".whc/")
    : false;

  if (!existsSync(pipelineStatusFile) || request.payload.force_reinitialize) {
    const payload = {
      started: false,
      completed: false,
      status: "idle",
      next_step: "Run whc_deploy after whc_prepare completes.",
    };
    mkdirSync(join(stateRootAbs, "state"), { recursive: true });
    writeFileSync(pipelineStatusFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  const checks = buildChecks();
  const manualActions = checks.filter((item) => item.status === "fail").map((item) => item.details);
  const createdPaths = trackedPaths.filter((item) => !existingBefore.has(item));

  return {
    ok: true,
    action_id: randomUUID(),
    tool: "whc_prepare",
    data: {
      state_root: relativeStateRoot,
      created_paths: createdPaths,
      gitignore_updated: gitignoreUpdated,
      already_initialized: hadStatusBefore,
      ready: manualActions.length === 0,
      manual_actions: manualActions,
      checks,
      pipeline_status_file: pipelineStatusFile,
      next_step:
        manualActions.length > 0
          ? "Complete manual_actions before running whc_deploy."
          : "Run whc_deploy (dry_run first) then whc_verify.",
    },
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "B",
      delivery_mechanism: "file_transfer",
    },
  };
}

function buildChecks(): Array<{ name: string; status: "pass" | "fail"; details: string }> {
  const requiredEnv = [
    "WHC_API_TOKEN",
    "WHC_USER",
    "WHC_HOST",
    "WHC_PROD_SSH_HOST",
    "WHC_PROD_SSH_USERNAME",
    "WHC_PROD_SSH_PRIVATE_KEY_PATH",
  ];

  return requiredEnv.map((key) => {
    const value = (process.env[key] ?? "").trim();
    if (value.length > 0) {
      return { name: key, status: "pass" as const, details: `${key} is configured.` };
    }
    return {
      name: key,
      status: "fail" as const,
      details: `Set ${key} in your .env before deploy.`,
    };
  });
}

function ensureGitignoreRule(rootDir: string, rule: string): boolean {
  const gitignorePath = join(rootDir, ".gitignore");

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${rule}\n`, "utf8");
    return true;
  }

  const content = readFileSync(gitignorePath, "utf8");
  const hasRule = content.split(/\r?\n/).some((line) => line.trim() === rule);
  if (hasRule) {
    return false;
  }

  const next = content.endsWith("\n") ? `${content}${rule}\n` : `${content}\n${rule}\n`;
  writeFileSync(gitignorePath, next, "utf8");
  return true;
}
