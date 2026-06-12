import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcUapiClient, UapiListRepositoriesResult } from "../clients/whc-uapi-client";
import { WhcSetupRemoteRequest } from "../schemas/whc-setup-remote";

export type BaselineKind = "default_wp" | "custom_app" | "empty" | "unknown";

export interface WhcSetupRemoteData {
  repository_root: string;
  ssh_remote_hint: string;
  was_existing: boolean;
  baseline_kind: BaselineKind;
  migration_guidance?: string;
  pipeline_status: "full_pass" | "pass_partial";
  phase_coverage: {
    code_state: "included" | "excluded";
    runtime_state: "included" | "excluded";
    data_state: "included" | "excluded";
    deployment_state: "included" | "excluded";
    notes: string[];
  };
  process_tracking: {
    started: boolean;
    completed: boolean;
    stage: "setup_remote";
    status: "completed" | "needs_manual_input";
    next_step: string;
    manual_actions: string[];
  };
  warnings: string[];
}

export interface WhcSetupRemoteHandlerDeps {
  uapiClient?: WhcUapiClient;
  actionIdFactory?: () => string;
}

export async function executeWhcSetupRemote(
  config: AppConfig,
  request: WhcSetupRemoteRequest,
  deps: WhcSetupRemoteHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcSetupRemoteData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const uapiClient = deps.uapiClient ?? new WhcUapiClient(config);

  const { deploy_target_path, clone_url, source_profile, release_intent, pipeline_id } = request.payload;

  const pathOwner = extractHomeOwner(deploy_target_path);
  if (pathOwner && pathOwner !== config.user) {
    const isStaging = request.payload.target_environment === "staging";
    const lines = [
      `Path owner mismatch: deploy_target_path belongs to '${pathOwner}' but WHC_USER is '${config.user}'.`,
    ];
    if (isStaging) {
      lines.push(
        "WHC managed staging uses a separate cPanel account; git repo setup via this user's UAPI cannot target it.",
        "Use managed_clone_sync mode to sync staging from live, or configure dedicated staging credentials.",
      );
    } else {
      const suggestedPayload = buildSuggestedSetupRemotePayload(request, config.user);
      lines.push(
        `Use a repository path under /home/${config.user}/... or switch credentials/workflow mode.`,
        "Copy-ready payload using current WHC_USER:",
        JSON.stringify(suggestedPayload, null, 2),
      );
    }
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_setup_remote",
      data: null,
      error: {
        code: "BUSINESS_POLICY_BLOCKED",
        message: lines.join("\n"),
        retryable: false,
      },
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "C",
        workflow_mode: config.workflowMode,
        pipeline_id,
        release_intent,
        source_profile,
        delivery_mechanism: "git_deploy",
      },
    };
  }

  // Dry run: return preview without making changes
  if (request.dry_run) {
    const sshRemoteHint = buildSshRemoteHint(config, deploy_target_path);
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_setup_remote",
      data: {
        repository_root: deploy_target_path,
        ssh_remote_hint: sshRemoteHint,
        was_existing: false,
        baseline_kind: "unknown",
        migration_guidance: "dry_run: no changes made. Run without dry_run to create repository.",
        pipeline_status: "pass_partial",
        phase_coverage: buildSetupRemotePhaseCoverage(true),
        process_tracking: {
          started: true,
          completed: true,
          stage: "setup_remote",
          status: "needs_manual_input",
          next_step: "Run whc_setup_remote without dry_run to create repository, then push local source to the returned SSH remote.",
          manual_actions: [
            "Ensure cPanel API token is available in WHC_API_TOKEN.",
            "Ensure SSH key is authorized on target cPanel account.",
            "Run local git remote add/set-url and git push to the ssh_remote_hint.",
          ],
        },
        warnings: [],
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "C",
        workflow_mode: config.workflowMode,
        pipeline_id,
        release_intent,
        source_profile,
        delivery_mechanism: "git_deploy",
      },
    };
  }

  // Check for existing repository at target path
  let listResult: UapiListRepositoriesResult;
  try {
    listResult = await uapiClient.listRepositories();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list repositories";
    return buildUapiErrorResponse(actionIdFactory(), startedAt, request, "AUTH_ERROR", message);
  }

  if (!listResult.ok) {
    return buildUapiErrorResponse(actionIdFactory(), startedAt, request, "TEMPORARY_UPSTREAM_ERROR", listResult.message);
  }

  const existing = listResult.repositories.find((r) => r.repository_root === deploy_target_path);

  if (existing) {
    const sshRemoteHint = buildSshRemoteHint(config, deploy_target_path);
    const baseline = inferBaselineKind(source_profile.source_kind);
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_setup_remote",
      data: {
        repository_root: deploy_target_path,
        ssh_remote_hint: sshRemoteHint,
        was_existing: true,
        baseline_kind: baseline,
        migration_guidance: buildMigrationGuidance(baseline, true),
        pipeline_status: "pass_partial",
        phase_coverage: buildSetupRemotePhaseCoverage(false),
        process_tracking: {
          started: true,
          completed: true,
          stage: "setup_remote",
          status: "needs_manual_input",
          next_step: "Push/update local source to this existing repository root, then run whc_deploy for the target environment.",
          manual_actions: [
            "Verify local git remote points to ssh_remote_hint.",
            "Push target branch from local workspace.",
          ],
        },
        warnings: [],
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "C",
        workflow_mode: config.workflowMode,
        pipeline_id,
        release_intent,
        source_profile,
        delivery_mechanism: "git_deploy",
      },
    };
  }

  // Create repository
  const createResult = await uapiClient.createRepository(deploy_target_path, clone_url);

  if (!createResult.ok) {
    return buildUapiErrorResponse(actionIdFactory(), startedAt, request, "TEMPORARY_UPSTREAM_ERROR", createResult.message);
  }

  const sshRemoteHint = buildSshRemoteHint(config, deploy_target_path);
  const baseline = inferBaselineKind(source_profile.source_kind);
  const warnings = buildWarnings(source_profile.source_kind, release_intent);

  return {
    ok: true,
    action_id: actionIdFactory(),
    tool: "whc_setup_remote",
    data: {
      repository_root: createResult.repository_root ?? deploy_target_path,
      ssh_remote_hint: sshRemoteHint,
      was_existing: false,
      baseline_kind: baseline,
      migration_guidance: buildMigrationGuidance(baseline, false),
      pipeline_status: "pass_partial",
      phase_coverage: buildSetupRemotePhaseCoverage(false),
      process_tracking: {
        started: true,
        completed: true,
        stage: "setup_remote",
        status: "needs_manual_input",
        next_step: "Set local git remote to ssh_remote_hint, push source branch, then execute whc_deploy.",
        manual_actions: [
          "Run: git remote add whc <ssh_remote_hint> (or git remote set-url whc <ssh_remote_hint>).",
          "Run: git push whc <branch>.",
          "Run whc_deploy with matching repository_root and branch.",
        ],
      },
      warnings,
    },
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "C",
      workflow_mode: config.workflowMode,
      pipeline_id,
      release_intent,
      source_profile,
      delivery_mechanism: "git_deploy",
    },
  };
}

function buildSshRemoteHint(config: AppConfig, deployTargetPath: string): string {
  const { username, host } = config.sshTargets.prod;
  return `${username}@${host}:${deployTargetPath}`;
}

function inferBaselineKind(sourceKind: string): BaselineKind {
  if (sourceKind === "full_site") return "custom_app";
  if (sourceKind === "partial_content" || sourceKind === "package_only") return "custom_app";
  return "unknown";
}

function buildMigrationGuidance(baseline: BaselineKind, wasExisting: boolean): string | undefined {
  if (wasExisting) {
    return "Repository already exists at target path. Verify remote URL in your local repo with `git remote -v`.";
  }
  if (baseline === "unknown") {
    return "Repository created. Inspect target path baseline before first deploy: confirm whether default WP or custom app is present, then reconcile runtime state.";
  }
  return undefined;
}

function buildWarnings(sourceKind: string, releaseIntent: string): string[] {
  const warnings: string[] = [];
  if (releaseIntent === "migrate") {
    warnings.push("Release intent is migrate: confirm uploads and content dependencies before promoting to live.");
  }
  if (sourceKind === "full_site" && releaseIntent === "deploy") {
    warnings.push("Full-site source: confirm deploy target path matches the intended webroot, not a subdirectory.");
  }
  return warnings;
}

function buildSetupRemotePhaseCoverage(dryRun: boolean): WhcSetupRemoteData["phase_coverage"] {
  return {
    code_state: "excluded",
    runtime_state: "excluded",
    data_state: "excluded",
    deployment_state: dryRun ? "excluded" : "included",
    notes: [
      "whc_setup_remote prepares Git repository wiring only; it does not sync code or bootstrap WordPress runtime/data.",
      "Manual local git push is required after setup to move source code.",
      dryRun ? "dry_run preview only; repository not created yet." : "Repository setup completed; continue with git push and deploy.",
    ],
  };
}

function extractHomeOwner(pathValue: string): string | undefined {
  const match = pathValue.match(/^\/home\/([^/]+)\//);
  return match?.[1];
}

function buildSuggestedSetupRemotePayload(request: WhcSetupRemoteRequest, currentUser: string): WhcSetupRemoteRequest {
  return {
    request_id: request.request_id,
    actor: request.actor,
    dry_run: request.dry_run,
    confirmed: request.confirmed,
    idempotency_key: request.idempotency_key,
    payload: {
      ...request.payload,
      deploy_target_path: `/home/${currentUser}/public_html`,
    },
  };
}

function buildUapiErrorResponse(
  actionId: string,
  startedAt: number,
  request: WhcSetupRemoteRequest,
  code: "AUTH_ERROR" | "TEMPORARY_UPSTREAM_ERROR",
  message: string,
): ToolResponseEnvelope<WhcSetupRemoteData> {
  return {
    ok: false,
    action_id: actionId,
    tool: "whc_setup_remote",
    data: null,
    error: { code, message, retryable: code === "TEMPORARY_UPSTREAM_ERROR" },
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "C",
      workflow_mode: undefined,
      pipeline_id: request.payload.pipeline_id,
      release_intent: request.payload.release_intent,
      source_profile: request.payload.source_profile,
      delivery_mechanism: "git_deploy",
    },
  };
}
