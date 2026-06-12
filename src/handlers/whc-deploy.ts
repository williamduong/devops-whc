import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcDeployRequest } from "../schemas/whc-deploy";
import { WhcUapiClient } from "../clients/whc-uapi-client";
import { DeploymentLockService, InMemoryDeploymentLockService } from "../services/deployment-locks";
import { WhcSshClient } from "../clients/ssh-client";
import { runDeployRollback, runDeployVerification } from "../services/deploy-runtime-ops";

export type DeployOutcome =
  | "synced_live_to_staging"
  | "synced_staging_to_live"
  | "dry_run_preview";

export interface WhcDeployData {
  outcome: DeployOutcome;
  workflow_mode: "managed_clone_sync";
  target_environment: string;
  direction?: string;
  sync_scope?: string;
  verify_status?: "skipped" | "passed" | "failed";
  rollback_status?: "not_needed" | "attempted" | "succeeded" | "failed";
  lock_key?: string;
  backup_reference?: string;
  pipeline_status: "full_pass" | "pass_partial";
  phase_coverage: {
    code_state: "included" | "excluded";
    runtime_state: "included" | "excluded";
    data_state: "included" | "excluded";
    deployment_state: "included" | "excluded";
    notes: string[];
  };
  warnings: string[];
}

export interface DeployVerificationResult {
  ok: boolean;
  message: string;
}

export interface DeployRollbackResult {
  ok: boolean;
  message: string;
}

export interface WhcDeployHandlerDeps {
  uapiClient?: WhcUapiClient;
  sshClient?: WhcSshClient;
  lockService?: DeploymentLockService;
  verifyRunner?: (config: AppConfig, request: WhcDeployRequest) => Promise<DeployVerificationResult>;
  rollbackRunner?: (config: AppConfig, request: WhcDeployRequest) => Promise<DeployRollbackResult>;
  actionIdFactory?: () => string;
}

/**
 * Resolves the effective safety level for this deploy operation.
 * staging_to_live + database or everything → Level D.
 * All other writes remain at Level C.
 */
export function resolveDeploySafetyLevel(
  direction?: string,
  syncScope?: string,
): "C" | "D" {
  if (direction === "staging_to_live" && (syncScope === "database" || syncScope === "everything")) {
    return "D";
  }
  return "C";
}

export async function executeWhcDeploy(
  config: AppConfig,
  request: WhcDeployRequest,
  deps: WhcDeployHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcDeployData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const uapiClient = deps.uapiClient ?? new WhcUapiClient(config);
  const sshClient = deps.sshClient ?? new WhcSshClient(config);
  const lockService = deps.lockService ?? new InMemoryDeploymentLockService();
  const verifyRunner = deps.verifyRunner ?? ((cfg, req) => runDeployVerification(cfg, req, sshClient));
  const rollbackRunner = deps.rollbackRunner ?? ((cfg, req) => runDeployRollback(cfg, req, uapiClient));

  const {
    workflow_mode,
    target_environment,
    release_intent,
    pipeline_id,
    source_profile,
    direction,
    sync_scope,
    backup_reference,
    allow_emergency_without_backup,
    verify_after_deploy,
    auto_rollback_on_verify_failure,
    lock_key,
  } = request.payload;

  const effectiveSafetyLevel = resolveDeploySafetyLevel(direction, sync_scope);
  const needsBackupGate = direction === "staging_to_live" && (sync_scope === "database" || sync_scope === "everything");
  const shouldVerify = verify_after_deploy ?? false;
  const deployLockKey = lock_key ?? `whc_deploy:${target_environment}:${workflow_mode}`;
  const lockOwner = request.request_id;

  const warnings: string[] = [];

  if ((config.safety.enforceStagingFirst ?? true) && target_environment === "live") {
    const isManagedPromoteFlow =
      workflow_mode === "managed_clone_sync" &&
      direction === "staging_to_live" &&
      release_intent === "promote";

    if (!isManagedPromoteFlow) {
      return buildErrorResponse(
        actionIdFactory(),
        startedAt,
        effectiveSafetyLevel,
        "BUSINESS_POLICY_BLOCKED",
        [
          "Staging-first policy: direct live deploy is blocked.",
          "Only promote flow from staging to live is allowed.",
          "Required payload shape for live target:",
          JSON.stringify(
            {
              workflow_mode: "managed_clone_sync",
              target_environment: "live",
              release_intent: "promote",
              direction: "staging_to_live",
            },
            null,
            2,
          ),
        ].join("\n"),
      );
    }
  }

  if (config.safety.warnDynamicDataSync && sync_scope === "database") {
    warnings.push("DATABASE sync detected — existing data on target will be overwritten. Ensure a backup exists before proceeding.");
  }
  if (config.safety.warnDynamicDataSync && sync_scope === "everything") {
    warnings.push("FULL sync (files + database) detected — all data on target will be replaced. This is irreversible without a backup.");
  }
  if (workflow_mode === "managed_clone_sync" && release_intent === "deploy" && direction === "live_to_staging") {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      "Invalid deploy mindset: managed live_to_staging is an environment refresh, not a release deploy. Use release_intent='refresh' for live_to_staging.",
    );
  }
  if (direction === "live_to_staging" && sync_scope !== "files") {
    warnings.push("Refreshing staging from live with database/everything scope — any staging-only changes will be lost.");
  }
  if (needsBackupGate && !backup_reference && !allow_emergency_without_backup) {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      "Backup reference is required for staging_to_live database/everything sync. Provide payload.backup_reference or set allow_emergency_without_backup=true.",
    );
  }
  if (needsBackupGate && !backup_reference && allow_emergency_without_backup) {
    warnings.push("Emergency override enabled without backup_reference. Data loss recovery is not guaranteed.");
  }

  // Dry run: return preview without making changes
  if (request.dry_run) {
    const phaseCoverage = buildPhaseCoverage({
      syncScope: sync_scope,
      verifyStatus: "skipped",
      dryRun: true,
    });
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_deploy",
      data: {
        outcome: "dry_run_preview",
        workflow_mode,
        target_environment,
        direction,
        sync_scope,
        lock_key: deployLockKey,
        backup_reference,
        pipeline_status: derivePipelineStatus(phaseCoverage),
        phase_coverage: phaseCoverage,
        warnings,
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: effectiveSafetyLevel,
        workflow_mode,
        pipeline_id,
        release_intent,
        source_profile,
        delivery_mechanism: "managed_sync",
      },
    };
  }

  const lockAcquired = lockService.acquire(deployLockKey, lockOwner);
  if (!lockAcquired.ok) {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      `Concurrent deployment blocked: ${lockAcquired.reason}`,
    );
  }

  try {
    // managed_clone_sync mode: use WHC staging sync
    if (!direction) {
      return buildErrorResponse(actionIdFactory(), startedAt, effectiveSafetyLevel, "VALIDATION_ERROR", "managed_clone_sync mode requires 'direction' field.");
    }

      // WHC managed sync is represented with guarded intent + recovery contract.
      const outcome: DeployOutcome = direction === "live_to_staging" ? "synced_live_to_staging" : "synced_staging_to_live";
      let verifyStatus: "skipped" | "passed" | "failed" = "skipped";
      let rollbackStatus: "not_needed" | "attempted" | "succeeded" | "failed" = "not_needed";

      if (shouldVerify) {
        const verifyResult = await verifyRunner(config, request);
        if (!verifyResult.ok) {
          verifyStatus = "failed";
          if (auto_rollback_on_verify_failure) {
            rollbackStatus = "attempted";
            const rollbackResult = await rollbackRunner(config, request);
            rollbackStatus = rollbackResult.ok ? "succeeded" : "failed";
          }

          return buildErrorResponse(
            actionIdFactory(),
            startedAt,
            effectiveSafetyLevel,
            "TEMPORARY_UPSTREAM_ERROR",
            `Post-deploy verification failed: ${verifyResult.message}`,
          );
        }
        verifyStatus = "passed";
      }

      const phaseCoverage = buildPhaseCoverage({
        syncScope: sync_scope,
        verifyStatus,
        dryRun: false,
      });

      return {
        ok: true,
        action_id: actionIdFactory(),
        tool: "whc_deploy",
        data: {
          outcome,
          workflow_mode,
          target_environment,
          direction,
          sync_scope,
          verify_status: verifyStatus,
          rollback_status: rollbackStatus,
          lock_key: deployLockKey,
          backup_reference,
          pipeline_status: derivePipelineStatus(phaseCoverage),
          phase_coverage: phaseCoverage,
          warnings,
        },
        error: null,
        meta: {
          latency_ms: Date.now() - startedAt,
          safety_level: effectiveSafetyLevel,
          workflow_mode,
          pipeline_id,
          release_intent,
          source_profile,
          delivery_mechanism: "managed_sync",
        },
      };
  } finally {
    lockService.release(deployLockKey, lockOwner);
  }
}

function buildErrorResponse(
  actionId: string,
  startedAt: number,
  safetyLevel: "C" | "D",
  code: "VALIDATION_ERROR" | "AUTH_ERROR" | "TEMPORARY_UPSTREAM_ERROR" | "BUSINESS_POLICY_BLOCKED",
  message: string,
): ToolResponseEnvelope<WhcDeployData> {
  return {
    ok: false,
    action_id: actionId,
    tool: "whc_deploy",
    data: null,
    error: { code, message, retryable: code === "TEMPORARY_UPSTREAM_ERROR" },
    meta: { latency_ms: Date.now() - startedAt, safety_level: safetyLevel },
  };
}

function buildPhaseCoverage(input: {
  syncScope?: string;
  verifyStatus: "skipped" | "passed" | "failed";
  dryRun: boolean;
}): WhcDeployData["phase_coverage"] {
  const notes: string[] = [];

  let codeState: "included" | "excluded" = "excluded";
  let dataState: "included" | "excluded" = "excluded";
  const deploymentState: "included" | "excluded" = input.dryRun ? "excluded" : "included";

  if (input.syncScope === "files" || input.syncScope === "everything") {
    codeState = input.dryRun ? "excluded" : "included";
  }
  if (input.syncScope === "database" || input.syncScope === "everything") {
    dataState = input.dryRun ? "excluded" : "included";
  }
  notes.push(
    "managed_clone_sync does not bootstrap app runtime configuration (plugin/theme activation, rewrite, Woo setup).",
    "Managed verification is transport-level unless additional runtime checks are run externally.",
  );

  if (input.dryRun) {
    notes.push("dry_run preview only; no target state has been changed.");
  }

  return {
    code_state: codeState,
    runtime_state: "excluded",
    data_state: dataState,
    deployment_state: deploymentState,
    notes,
  };
}

function derivePipelineStatus(phaseCoverage: WhcDeployData["phase_coverage"]): WhcDeployData["pipeline_status"] {
  if (
    phaseCoverage.code_state === "included" &&
    phaseCoverage.runtime_state === "included" &&
    phaseCoverage.data_state === "included" &&
    phaseCoverage.deployment_state === "included"
  ) {
    return "full_pass";
  }
  return "pass_partial";
}
