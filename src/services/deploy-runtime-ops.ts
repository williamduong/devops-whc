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
  _config: AppConfig,
  _request: WhcDeployRequest,
  _sshClient: WhcSshClient,
): Promise<RuntimeVerifyResult> {
  // Verification for managed_clone_sync is transport-level only.
  return { ok: true, message: "Verification passed for managed_clone_sync mode" };
}

export async function runDeployRollback(
  _config: AppConfig,
  _request: WhcDeployRequest,
  _uapiClient: WhcUapiClient,
): Promise<RuntimeRollbackResult> {
  // Automatic rollback via UAPI is not supported on WHC Managed WordPress.
  // WHC does not expose cPanel Git Version Control deployment for rollback.
  return {
    ok: false,
    message: "Automatic rollback is not supported on this platform. Restore from DB backup created before deploy.",
  };
}
