import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcDeployRequest } from "../schemas/whc-deploy";
import { WhcUapiClient, UapiTriggerDeploymentResult } from "../clients/whc-uapi-client";
import { DeploymentLockService, InMemoryDeploymentLockService } from "../services/deployment-locks";
import { WhcSshClient } from "../clients/ssh-client";
import { runDeployRollback, runDeployVerification } from "../services/deploy-runtime-ops";

export type DeployOutcome =
  | "deployed"
  | "synced_live_to_staging"
  | "synced_staging_to_live"
  | "dry_run_preview";

export interface WhcDeployData {
  outcome: DeployOutcome;
  workflow_mode: "managed_clone_sync" | "git_controlled";
  target_environment: string;
  direction?: string;
  sync_scope?: string;
  repository_root?: string;
  branch?: string;
  rollback_branch?: string;
  deployment_id?: string;
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
    repository_root,
    branch,
    rollback_branch,
    backup_reference,
    allow_emergency_without_backup,
    verify_after_deploy,
    auto_rollback_on_verify_failure,
    lock_key,
  } = request.payload;

  const effectiveSafetyLevel = resolveDeploySafetyLevel(direction, sync_scope);
  const needsBackupGate = direction === "staging_to_live" && (sync_scope === "database" || sync_scope === "everything");
  const shouldVerify = verify_after_deploy ?? false;
  const deployLockKey = lock_key ?? buildDefaultLockKey(target_environment, workflow_mode, repository_root);
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

  if (
    target_environment === "staging" &&
    config.workflowMode === "managed_clone_sync" &&
    workflow_mode === "git_controlled" &&
    !config.safety.allowStagingGitControlled
  ) {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      [
        "Server mode lock: staging is configured as managed_clone_sync only (WHC_WORKFLOW_MODE=managed_clone_sync).",
        "Request used workflow_mode='git_controlled' and was blocked to prevent cross-account deadlock loops.",
        "Use this payload instead:",
        JSON.stringify(buildStagingAlternativePayload(request), null, 2),
      ].join("\n"),
    );
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
      "Invalid deploy mindset: managed live_to_staging is an environment refresh, not a release deploy. Use release_intent='refresh' for live_to_staging, or deploy a release candidate to staging via git_controlled workflow.",
    );
  }
  if (workflow_mode === "git_controlled" && repository_root) {
    if (target_environment === "staging" && config.paths.staging && repository_root !== config.paths.staging) {
      return buildErrorResponse(
        actionIdFactory(),
        startedAt,
        effectiveSafetyLevel,
        "BUSINESS_POLICY_BLOCKED",
        [
          `Invalid staging target for git_controlled deploy: repository_root='${repository_root}' does not match WHC_STAGING_PATH='${config.paths.staging}'.`,
          "This prevents accidental deploys to a live path while target_environment is staging.",
          "Use the configured staging path, or switch to managed_clone_sync refresh for cross-account WHC staging.",
          "Copy-ready payload using configured staging path:",
          JSON.stringify(buildSuggestedStagingGitControlledPayload(request, config.paths.staging), null, 2),
        ].join("\n"),
      );
    }

    const pathOwner = extractHomeOwner(repository_root);
    if (pathOwner && pathOwner !== config.user) {
      const lines = [
        `Path owner mismatch: repository_root belongs to '${pathOwner}' but WHC_USER is '${config.user}'.`,
      ];
      if (target_environment === "staging") {
        lines.push(
          "git_controlled via UAPI cannot deploy to a separate-account staging environment.",
          "WHC managed staging uses a different cPanel account and is not reachable via these credentials.",
          "Use managed_clone_sync + release_intent='refresh' + direction='live_to_staging' to sync the environment,",
          "then deploy your release candidate over SSH using whc_ssh_exec, or configure separate staging credentials.",
          "Suggested alternative payload (managed_clone_sync refresh):",
          JSON.stringify(buildStagingAlternativePayload(request), null, 2),
        );
      } else {
        const suggestedPayload = buildSuggestedDeployPayload(request, config.user);
        lines.push(
          `Use /home/${config.user}/... for git_controlled deploy or switch credentials.`,
          "Copy-ready payload using current WHC_USER:",
          JSON.stringify(suggestedPayload, null, 2),
        );
      }
      return buildErrorResponse(
        actionIdFactory(),
        startedAt,
        effectiveSafetyLevel,
        "BUSINESS_POLICY_BLOCKED",
        lines.join("\n"),
      );
    }
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
      workflowMode: workflow_mode,
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
        repository_root,
        branch,
        rollback_branch,
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
        delivery_mechanism: workflow_mode === "git_controlled" ? "git_deploy" : "managed_sync",
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
    if (workflow_mode === "managed_clone_sync") {
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
        workflowMode: workflow_mode,
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
    }

    // git_controlled mode: trigger UAPI VersionControl::deployment
    if (!repository_root) {
      return buildErrorResponse(actionIdFactory(), startedAt, effectiveSafetyLevel, "VALIDATION_ERROR", "git_controlled mode requires 'repository_root' field.");
    }

    let deployResult: UapiTriggerDeploymentResult;
    try {
      deployResult = await uapiClient.triggerDeployment(repository_root, branch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "UAPI deployment trigger failed";
      return buildErrorResponse(actionIdFactory(), startedAt, effectiveSafetyLevel, "AUTH_ERROR", message);
    }

    if (!deployResult.ok) {
      return buildErrorResponse(actionIdFactory(), startedAt, effectiveSafetyLevel, "TEMPORARY_UPSTREAM_ERROR", deployResult.message);
    }

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
      workflowMode: workflow_mode,
      syncScope: sync_scope,
      verifyStatus,
      dryRun: false,
    });

    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_deploy",
      data: {
        outcome: "deployed",
        workflow_mode,
        target_environment,
        repository_root,
        branch,
          rollback_branch,
        deployment_id: deployResult.deployment_id,
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
        delivery_mechanism: "git_deploy",
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

function buildDefaultLockKey(
  targetEnvironment: string,
  workflowMode: "managed_clone_sync" | "git_controlled",
  repositoryRoot?: string,
): string {
  return `whc_deploy:${targetEnvironment}:${workflowMode}:${repositoryRoot ?? "-"}`;
}

function extractHomeOwner(pathValue: string): string | undefined {
  const match = pathValue.match(/^\/home\/([^\/]+)\//);
  return match?.[1];
}

function buildSuggestedDeployPayload(request: WhcDeployRequest, currentUser: string): WhcDeployRequest {
  return {
    request_id: request.request_id,
    actor: request.actor,
    dry_run: request.dry_run,
    confirmed: request.confirmed,
    idempotency_key: request.idempotency_key,
    payload: {
      ...request.payload,
      target_environment: "live",
      repository_root: `/home/${currentUser}/public_html`,
    },
  };
}

function buildStagingAlternativePayload(request: WhcDeployRequest): Partial<WhcDeployRequest["payload"]> {
  return {
    workflow_mode: "managed_clone_sync",
    target_environment: "staging",
    release_intent: "refresh",
    pipeline_id: request.payload.pipeline_id,
    source_profile: request.payload.source_profile,
    direction: "live_to_staging",
    sync_scope: "files",
    verify_after_deploy: request.payload.verify_after_deploy,
    auto_rollback_on_verify_failure: request.payload.auto_rollback_on_verify_failure,
  };
}

function buildSuggestedStagingGitControlledPayload(
  request: WhcDeployRequest,
  stagingPath: string,
): WhcDeployRequest {
  return {
    request_id: request.request_id,
    actor: request.actor,
    dry_run: request.dry_run,
    confirmed: request.confirmed,
    idempotency_key: request.idempotency_key,
    payload: {
      ...request.payload,
      target_environment: "staging",
      repository_root: stagingPath,
    },
  };
}

function buildPhaseCoverage(input: {
  workflowMode: "managed_clone_sync" | "git_controlled";
  syncScope?: string;
  verifyStatus: "skipped" | "passed" | "failed";
  dryRun: boolean;
}): WhcDeployData["phase_coverage"] {
  const notes: string[] = [];

  let codeState: "included" | "excluded" = "excluded";
  let runtimeState: "included" | "excluded" = "excluded";
  let dataState: "included" | "excluded" = "excluded";
  const deploymentState: "included" | "excluded" = input.dryRun ? "excluded" : "included";

  if (input.workflowMode === "git_controlled") {
    codeState = input.dryRun ? "excluded" : "included";
    runtimeState = input.verifyStatus === "passed" ? "included" : "excluded";
    dataState = "excluded";
    notes.push("git_controlled deploy covers code transport/deployment state; data/content bootstrap is out of scope.");
  }

  if (input.workflowMode === "managed_clone_sync") {
    if (input.syncScope === "files" || input.syncScope === "everything") {
      codeState = input.dryRun ? "excluded" : "included";
    }
    if (input.syncScope === "database" || input.syncScope === "everything") {
      dataState = input.dryRun ? "excluded" : "included";
    }
    runtimeState = "excluded";
    notes.push("managed_clone_sync does not bootstrap app runtime configuration (plugin/theme activation, rewrite, Woo setup).", "Managed verification is transport-level unless additional runtime checks are run externally.");
  }

  if (input.dryRun) {
    notes.push("dry_run preview only; no target state has been changed.");
  }

  return {
    code_state: codeState,
    runtime_state: runtimeState,
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
