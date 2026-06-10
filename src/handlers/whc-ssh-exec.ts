import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcSshExecRequest, isCommandAllowed } from "../schemas/whc-ssh-exec";
import { WhcSshClient, SshExecResult } from "../clients/ssh-client";

export interface WhcSshExecData {
  target_environment: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_ok: boolean;
}

export interface WhcSshExecHandlerDeps {
  sshClient?: WhcSshClient;
  actionIdFactory?: () => string;
}

export async function executeWhcSshExec(
  config: AppConfig,
  request: WhcSshExecRequest,
  deps: WhcSshExecHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcSshExecData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const sshClient = deps.sshClient ?? new WhcSshClient(config);

  const { target_environment, raw_command, working_dir } = request.payload;

  // Check allowlist/denylist before any SSH attempt
  const allowed = isCommandAllowed(raw_command);
  if (!allowed.allowed) {
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_ssh_exec",
      data: null,
      error: {
        code: "BUSINESS_POLICY_BLOCKED",
        message: allowed.reason ?? "Command blocked by policy",
        retryable: false,
      },
      meta: { latency_ms: Date.now() - startedAt, safety_level: "C" },
    };
  }

  // Dry run: return preview without executing
  if (request.dry_run) {
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_ssh_exec",
      data: {
        target_environment,
        command: raw_command,
        stdout: "",
        stderr: "",
        exit_ok: true,
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "C",
        delivery_mechanism: "ssh_exec",
      },
    };
  }

  const finalCommand = working_dir ? `cd ${working_dir} && ${raw_command}` : raw_command;

  let execResult: SshExecResult;
  try {
    if (target_environment === "staging") {
      const stagingTarget = config.sshTargets.staging;
      if (!stagingTarget) {
        return {
          ok: false,
          action_id: actionIdFactory(),
          tool: "whc_ssh_exec",
          data: null,
          error: {
            code: "BUSINESS_POLICY_BLOCKED",
            message: "Staging SSH target is not configured.",
            retryable: false,
          },
          meta: { latency_ms: Date.now() - startedAt, safety_level: "C" },
        };
      }

      if (!stagingTarget.privateKeyPath) {
        if (!stagingTarget.password) {
          return {
            ok: false,
            action_id: actionIdFactory(),
            tool: "whc_ssh_exec",
            data: null,
            error: {
              code: "BUSINESS_POLICY_BLOCKED",
              message: "whc_ssh_exec requires staging SSH credentials. Configure either WHC_STAGING_SSH_PRIVATE_KEY_PATH or WHC_STAGING_SSH_PASSWORD.",
              retryable: false,
            },
            meta: { latency_ms: Date.now() - startedAt, safety_level: "C" },
          };
        }

        execResult = await sshClient.execWithPassword(
          {
            host: stagingTarget.host,
            port: stagingTarget.port,
            username: stagingTarget.username,
            password: stagingTarget.password,
          },
          finalCommand,
        );
      } else {
        execResult = await sshClient.execWithKey(
          {
            host: stagingTarget.host,
            port: stagingTarget.port,
            username: stagingTarget.username,
            privateKeyPath: stagingTarget.privateKeyPath,
          },
          finalCommand,
        );
      }
    } else {
      execResult = await sshClient.execWithKey(config.sshTargets.prod, finalCommand);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSH exec failed";
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_ssh_exec",
      data: null,
      error: { code: "AUTH_ERROR", message, retryable: false },
      meta: { latency_ms: Date.now() - startedAt, safety_level: "C" },
    };
  }

  return {
    ok: execResult.ok,
    action_id: actionIdFactory(),
    tool: "whc_ssh_exec",
    data: {
      target_environment,
      command: raw_command,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      exit_ok: execResult.ok,
    },
    error: execResult.ok
      ? null
      : {
          code: "UNKNOWN_UPSTREAM_ERROR",
          message: execResult.message || "Command exited with non-zero status",
          retryable: false,
        },
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "C",
      delivery_mechanism: "ssh_exec",
    },
  };
}
