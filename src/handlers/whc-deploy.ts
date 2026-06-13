import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcDeployRequest } from "../schemas/whc-deploy";
import { WhcUapiClient } from "../clients/whc-uapi-client";
import { DeploymentLockService, InMemoryDeploymentLockService } from "../services/deployment-locks";
import { WhcSshClient } from "../clients/ssh-client";
import { runDeployRollback, runDeployVerification } from "../services/deploy-runtime-ops";

export type DeployOutcome = "deployment_triggered" | "dry_run_preview";

export interface WhcDeployData {
  outcome: DeployOutcome;
  workflow_mode: "git_deploy" | "ssh_scp_wpcli";
  target_environment: string;
  repository_root?: string;
  branch?: string;
  direction?: string;
  sync_scope?: string;
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

export function resolveDeploySafetyLevel(): "C" | "D" {
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
    repository_root,
    branch,
    direction,
    sync_scope,
    backup_reference,
    verify_after_deploy,
    auto_rollback_on_verify_failure,
    lock_key,
  } = request.payload;

  const effectiveSafetyLevel = resolveDeploySafetyLevel();
  const shouldVerify = verify_after_deploy ?? false;
  const deployLockKey = lock_key ?? `whc_deploy:${target_environment}:${workflow_mode}:${repository_root ?? "unset"}`;
  const lockOwner = request.request_id;
  const warnings: string[] = [];

  if ((config.safety.enforceStagingFirst ?? true) && workflow_mode === "git_deploy" && target_environment === "live" && release_intent !== "promote") {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      [
        "Staging-first policy: direct live git deployment is blocked.",
        "Only release_intent='promote' is allowed when target_environment='live'.",
      ].join("\n"),
    );
  }

  if (workflow_mode === "ssh_scp_wpcli") {
    const sourceScriptHint = [
      "ssh_scp_wpcli execution is not implemented in whc_deploy yet.",
      "This workflow is modeled after mytho/source where deploy is:",
      "1. doctor",
      "2. backup",
      "3. scp code sync",
      "4. wp-cli runtime bootstrap",
      "5. wp eval-file seed/bootstrap",
      "6. HTTP/API smoke",
      "Use the project-local pipeline script for real execution until source-specific deploy integration lands.",
    ].join("\n");

    if (request.dry_run) {
      const phaseCoverage = buildPhaseCoverage({
        workflowMode: workflow_mode,
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
          warnings: [...warnings, sourceScriptHint],
        },
        error: null,
        meta: {
          latency_ms: Date.now() - startedAt,
          safety_level: effectiveSafetyLevel,
          workflow_mode,
          pipeline_id,
          release_intent,
          source_profile,
          delivery_mechanism: "file_transfer",
        },
      };
    }

    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "BUSINESS_POLICY_BLOCKED",
      sourceScriptHint,
    );
  }

  if (direction || sync_scope) {
    warnings.push("direction/sync_scope are legacy managed-sync fields and are ignored by git_deploy.");
  }
  if (!repository_root) {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      effectiveSafetyLevel,
      "VALIDATION_ERROR",
      "git_deploy requires payload.repository_root so WHC knows which cPanel-managed repository to deploy.",
    );
  }
  if (!branch) {
    warnings.push("No branch was supplied; cPanel will deploy the repository's current configured HEAD.");
  }

  if (request.dry_run) {
    const phaseCoverage = buildPhaseCoverage({
      workflowMode: workflow_mode,
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
        repository_root,
        branch,
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
        delivery_mechanism: "git_deploy",
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
    const deployResult = await uapiClient.triggerDeployment(repository_root, branch);
    if (!deployResult.ok) {
      return buildErrorResponse(
        actionIdFactory(),
        startedAt,
        effectiveSafetyLevel,
        "TEMPORARY_UPSTREAM_ERROR",
        `Git deployment trigger failed: ${deployResult.message}`,
      );
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
      verifyStatus,
      dryRun: false,
    });

    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_deploy",
      data: {
        outcome: "deployment_triggered",
        workflow_mode,
        target_environment,
        repository_root,
        branch,
        direction,
        sync_scope,
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

function buildPhaseCoverage(input: {
  workflowMode: "git_deploy" | "ssh_scp_wpcli";
  verifyStatus: "skipped" | "passed" | "failed";
  dryRun: boolean;
}): WhcDeployData["phase_coverage"] {
  const notes: string[] = [];

  const codeState: "included" | "excluded" = input.dryRun ? "excluded" : "included";
  const deploymentState: "included" | "excluded" = input.dryRun ? "excluded" : "included";

  if (input.workflowMode === "git_deploy") {
    notes.push(
      "git_deploy triggers a cPanel deployment task for repository-managed code delivery.",
      "git_deploy does not bootstrap WordPress runtime/data; use separate runtime checks or project-specific scripts for that layer.",
    );
  } else {
    notes.push(
      "ssh_scp_wpcli is expected to cover code sync, WP-CLI runtime bootstrap, seed/bootstrap, and smoke gating.",
      "whc_deploy does not execute that source-specific flow yet; use a project-local pipeline script for real runs today.",
    );
  }

  if (input.verifyStatus === "passed") {
    notes.push("Post-deploy verification passed.");
  }
  if (input.verifyStatus === "failed") {
    notes.push("Post-deploy verification failed.");
  }
  if (input.dryRun) {
    notes.push("dry_run preview only; no target state has been changed.");
  }

  return {
    code_state: codeState,
    runtime_state: "excluded",
    data_state: "excluded",
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
