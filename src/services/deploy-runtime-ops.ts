import { AppConfig } from "../config/env";
import { WhcDeployRequest } from "../schemas/whc-deploy";
import { WhcSshClient } from "../clients/ssh-client";
import { WhcUapiClient } from "../clients/whc-uapi-client";

export interface RuntimeVerifyResult {
  ok: boolean;
  message: string;
}

export interface RuntimeRollbackResult {
  ok: boolean;
  message: string;
}

export async function runDeployVerification(
  config: AppConfig,
  request: WhcDeployRequest,
  sshClient: WhcSshClient,
): Promise<RuntimeVerifyResult> {
  const payload = request.payload;

  if (payload.workflow_mode !== "git_controlled") {
    return { ok: true, message: "Verification passed for managed_clone_sync mode" };
  }

  if (!payload.repository_root) {
    return { ok: false, message: "Missing repository_root for verification" };
  }

  const repoPath = shellQuote(payload.repository_root);
  const verifyProfile = resolveVerifyProfile(payload.source_profile.source_kind);
  const commandParts = [
    `test -d ${repoPath} && echo __PATH_OK__ || echo __PATH_MISSING__`,
    `if [ -f ${repoPath}/.cpanel.yml ]; then echo __CPANEL_YML_OK__; else echo __CPANEL_YML_MISSING__; fi`,
  ];

  if (verifyProfile.requireWpCliCheck) {
    commandParts.push(
      `if command -v wp >/dev/null 2>&1; then wp core is-installed --path=${repoPath} >/dev/null 2>&1 && echo __WP_OK__ || echo __WP_NOT_READY__; else echo __WPCLI_MISSING__; fi`,
    );
  }

  const command = commandParts.join(" ; ");

  const target = resolveTarget(config, payload.target_environment);
  if (!target.ok) {
    return { ok: false, message: target.message };
  }

  const sshResult = await sshClient.execWithKey(target.value, command);
  if (!sshResult.ok) {
    return { ok: false, message: `SSH verify command failed: ${sshResult.message}` };
  }

  const output = sshResult.stdout;
  if (output.includes("__PATH_MISSING__")) {
    return { ok: false, message: "Deployment path does not exist after deploy" };
  }

  if (output.includes("__CPANEL_YML_MISSING__")) {
    return { ok: false, message: ".cpanel.yml is missing in deployment root" };
  }

  if (verifyProfile.requireWpCliCheck && output.includes("__WPCLI_MISSING__")) {
    return { ok: false, message: "WP-CLI is required for full_site verification but is not available" };
  }

  if (verifyProfile.requireWpCliCheck && output.includes("__WP_NOT_READY__")) {
    return { ok: false, message: "WordPress core is not installed/ready after deploy" };
  }

  return { ok: true, message: `Runtime verification passed (${verifyProfile.name})` };
}

export async function runDeployRollback(
  _config: AppConfig,
  request: WhcDeployRequest,
  uapiClient: WhcUapiClient,
): Promise<RuntimeRollbackResult> {
  const payload = request.payload;

  if (payload.workflow_mode !== "git_controlled") {
    return {
      ok: false,
      message: "Automatic rollback is currently supported only for git_controlled mode",
    };
  }

  if (!payload.repository_root) {
    return { ok: false, message: "Missing repository_root for rollback" };
  }

  if (!payload.rollback_branch) {
    return {
      ok: false,
      message: "rollback_branch is required for automatic rollback",
    };
  }

  const rollbackResult = await uapiClient.triggerDeployment(payload.repository_root, payload.rollback_branch);
  if (!rollbackResult.ok) {
    return {
      ok: false,
      message: `Rollback deployment failed: ${rollbackResult.message}`,
    };
  }

  return { ok: true, message: `Rollback deployed from branch ${payload.rollback_branch}` };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveVerifyProfile(sourceKind: string): { name: "wordpress" | "generic"; requireWpCliCheck: boolean } {
  if (sourceKind === "full_site") {
    return { name: "wordpress", requireWpCliCheck: true };
  }

  if (sourceKind === "package_only" || sourceKind === "artifact_first") {
    return { name: "generic", requireWpCliCheck: false };
  }

  return { name: "generic", requireWpCliCheck: false };
}

function resolveTarget(config: AppConfig, environment: "live" | "staging"):
  | { ok: true; value: { host: string; port: number; username: string; privateKeyPath: string } }
  | { ok: false; message: string } {
  if (environment === "live") {
    return { ok: true, value: config.sshTargets.prod };
  }

  const staging = config.sshTargets.staging;
  if (!staging) {
    return { ok: false, message: "Staging SSH target is not configured" };
  }

  if (!staging.privateKeyPath) {
    return { ok: false, message: "Staging verification requires key-based SSH auth" };
  }

  return {
    ok: true,
    value: {
      host: staging.host,
      port: staging.port,
      username: staging.username,
      privateKeyPath: staging.privateKeyPath,
    },
  };
}
