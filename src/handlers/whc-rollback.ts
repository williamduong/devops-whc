import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcUapiClient } from "../clients/whc-uapi-client";
import { WhcSshClient } from "../clients/ssh-client";
import { WhcRollbackRequest } from "../schemas/whc-rollback";
import { findLatestVerifyReportFile, readJsonFile } from "../state/workspace-state";

export interface WhcRollbackData {
  rollback_mode: "git_branch" | "db_backup" | "managed_sync_reverse";
  rollback_status: "preview" | "executed";
  actions: string[];
  warnings: string[];
  verify_required: boolean;
  verify_chain: {
    source: string;
    final_status: string;
    accepted: boolean;
  };
  next_step: string;
}

export interface WhcRollbackHandlerDeps {
  uapiClient?: WhcUapiClient;
  sshClient?: WhcSshClient;
  actionIdFactory?: () => string;
}

export async function executeWhcRollback(
  config: AppConfig,
  request: WhcRollbackRequest,
  deps: WhcRollbackHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcRollbackData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const uapiClient = deps.uapiClient ?? new WhcUapiClient(config);
  const sshClient = deps.sshClient ?? new WhcSshClient(config);

  const chain = resolveVerifyChain(request);
  if (!chain.accepted) {
    return buildError(
      actionIdFactory(),
      startedAt,
      "BUSINESS_POLICY_BLOCKED",
      "Rollback requires a PASS verify-chain from whc_verify. Provide verify_release_id/verify_report_path with final_status=PASS.",
    );
  }

  const actions: string[] = [];
  const warnings: string[] = [];

  if (request.dry_run) {
    if (request.payload.rollback_mode === "git_branch") {
      const repositoryRoot = request.payload.repository_root ?? config.paths.prod;
      actions.push(`Would trigger UAPI deployment on ${repositoryRoot} with branch ${request.payload.rollback_branch}.`);
    }
    if (request.payload.rollback_mode === "db_backup") {
      actions.push(`Would import DB backup reference ${request.payload.backup_reference} on ${request.payload.target_environment}.`);
      warnings.push("DB restore can overwrite runtime data and is irreversible without additional backups.");
    }
    if (request.payload.rollback_mode === "managed_sync_reverse") {
      actions.push(`Would perform managed reverse sync direction ${request.payload.direction}.`);
      warnings.push("Managed reverse sync can overwrite files/data on destination environment.");
    }

    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_rollback",
      data: {
        rollback_mode: request.payload.rollback_mode,
        rollback_status: "preview",
        actions,
        warnings,
        verify_required: true,
        verify_chain: chain,
        next_step: "Re-run with dry_run=false and confirmed=true to execute rollback.",
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "D",
        delivery_mechanism: "git_deploy",
      },
    };
  }

  if (request.payload.rollback_mode === "git_branch") {
    const repositoryRoot = request.payload.repository_root ?? config.paths.prod;
    const result = await uapiClient.triggerDeployment(repositoryRoot, request.payload.rollback_branch);
    if (!result.ok) {
      return buildError(actionIdFactory(), startedAt, "TEMPORARY_UPSTREAM_ERROR", `Rollback deployment failed: ${result.message}`);
    }
    actions.push(`Triggered rollback deployment on ${repositoryRoot} with branch ${request.payload.rollback_branch}.`);
  }

  if (request.payload.rollback_mode === "db_backup") {
    const target = request.payload.target_environment === "staging" ? config.sshTargets.staging : config.sshTargets.prod;
    if (!target || !target.privateKeyPath) {
      return buildError(actionIdFactory(), startedAt, "BUSINESS_POLICY_BLOCKED", "DB rollback requires key-based SSH target configuration.");
    }

    const dumpPath = request.payload.backup_reference!;
    const wpPath = request.payload.target_environment === "staging" ? config.paths.staging ?? config.paths.prod : config.paths.prod;
    const cmd = `cd '${wpPath.replace(/'/g, `"'"`)}' && wp db import '${dumpPath.replace(/'/g, `"'"`)}'`;
    const sshResult = await sshClient.execWithKey(
      {
        host: target.host,
        port: target.port,
        username: target.username,
        privateKeyPath: target.privateKeyPath,
      },
      cmd,
    );

    if (!sshResult.ok) {
      return buildError(actionIdFactory(), startedAt, "TEMPORARY_UPSTREAM_ERROR", `DB rollback failed: ${sshResult.message}`);
    }

    actions.push(`Imported DB backup ${dumpPath} on ${request.payload.target_environment}.`);
    warnings.push("DB rollback executed. Run whc_verify immediately.");
  }

  if (request.payload.rollback_mode === "managed_sync_reverse") {
    warnings.push("managed_sync_reverse execution is not automated yet; manual WHC action required.");
    actions.push(`Manual action required: execute reverse sync ${request.payload.direction} from WHC panel.`);
  }

  return {
    ok: true,
    action_id: actionIdFactory(),
    tool: "whc_rollback",
    data: {
      rollback_mode: request.payload.rollback_mode,
      rollback_status: "executed",
      actions,
      warnings,
      verify_required: true,
      verify_chain: chain,
      next_step: "Run whc_verify to confirm rollback integrity.",
    },
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "D",
      delivery_mechanism: request.payload.rollback_mode === "git_branch" ? "git_deploy" : "ssh_exec",
    },
  };
}

function resolveVerifyChain(request: WhcRollbackRequest): { source: string; final_status: string; accepted: boolean } {
  const reportPath = request.payload.verify_report_path ?? findLatestVerifyReportFile(process.cwd());
  if (!reportPath) {
    return { source: "missing", final_status: "missing", accepted: false };
  }

  const report = readJsonFile(reportPath);
  if (!report) {
    return { source: reportPath, final_status: "invalid", accepted: false };
  }

  if (request.payload.verify_release_id && report.release_id !== request.payload.verify_release_id) {
    return { source: reportPath, final_status: String(report.final_status ?? "unknown"), accepted: false };
  }

  const finalStatus = String(report.final_status ?? "unknown");
  return {
    source: reportPath,
    final_status: finalStatus,
    accepted: finalStatus === "PASS",
  };
}

function buildError(
  actionId: string,
  startedAt: number,
  code: "BUSINESS_POLICY_BLOCKED" | "TEMPORARY_UPSTREAM_ERROR",
  message: string,
): ToolResponseEnvelope<WhcRollbackData> {
  return {
    ok: false,
    action_id: actionId,
    tool: "whc_rollback",
    data: null,
    error: {
      code,
      message,
      retryable: code === "TEMPORARY_UPSTREAM_ERROR",
    },
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "D",
    },
  };
}
