import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcGetLogsRequest } from "../schemas/whc-get-logs";
import { WhcSshClient, SshExecResult } from "../clients/ssh-client";

export interface WhcGetLogsData {
  target_environment: string;
  log_type: string;
  lines_returned: number;
  entries: string[];
  log_path: string;
}

export interface WhcGetLogsHandlerDeps {
  sshClient?: WhcSshClient;
  actionIdFactory?: () => string;
}

const LOG_PATHS: Record<string, Record<string, string>> = {
  apache_error: {
    live: "/usr/local/apache/logs/error_log",
    staging: "/usr/local/apache/logs/error_log",
  },
  apache_access: {
    live: "/usr/local/apache/logs/access_log",
    staging: "/usr/local/apache/logs/access_log",
  },
  php_error: {
    live: "~/public_html/error_log",
    staging: "~/public_html/error_log",
  },
  cron: {
    live: "~/var/log/cron_log",
    staging: "~/var/log/cron_log",
  },
};

function resolveLogPath(logType: string, targetEnvironment: string): string {
  return LOG_PATHS[logType]?.[targetEnvironment] ?? `~/logs/${logType}.log`;
}

export async function executeWhcGetLogs(
  config: AppConfig,
  request: WhcGetLogsRequest,
  deps: WhcGetLogsHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcGetLogsData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const sshClient = deps.sshClient ?? new WhcSshClient(config);

  const { target_environment, log_type, lines } = request.payload;
  const logPath = resolveLogPath(log_type, target_environment);
  const command = `tail -n ${lines} ${logPath} 2>/dev/null || echo '__LOG_NOT_FOUND__'`;

  let execResult: SshExecResult;
  try {
    if (target_environment === "staging" && config.sshTargets.staging?.privateKeyPath) {
      const stagingTarget = config.sshTargets.staging;
      execResult = await sshClient.execWithKey(
        {
          host: stagingTarget.host,
          port: stagingTarget.port,
          username: stagingTarget.username,
          privateKeyPath: stagingTarget.privateKeyPath!,
        },
        command,
      );
    } else if (target_environment === "staging" && !config.sshTargets.staging) {
      return {
        ok: false,
        action_id: actionIdFactory(),
        tool: "whc_get_logs",
        data: null,
        error: {
          code: "BUSINESS_POLICY_BLOCKED",
          message: "Staging SSH target is not configured. Set WHC_STAGING_SSH_* env vars.",
          retryable: false,
        },
        meta: { latency_ms: Date.now() - startedAt, safety_level: "A" },
      };
    } else {
      execResult = await sshClient.execWithKey(config.sshTargets.prod, command);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSH exec failed";
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_get_logs",
      data: null,
      error: { code: "AUTH_ERROR", message, retryable: false },
      meta: { latency_ms: Date.now() - startedAt, safety_level: "A" },
    };
  }

  if (execResult.stdout.includes("__LOG_NOT_FOUND__")) {
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_get_logs",
      data: {
        target_environment,
        log_type,
        lines_returned: 0,
        entries: [],
        log_path: logPath,
      },
      error: null,
      meta: { latency_ms: Date.now() - startedAt, safety_level: "A", delivery_mechanism: "ssh_exec" },
    };
  }

  const entries = execResult.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return {
    ok: true,
    action_id: actionIdFactory(),
    tool: "whc_get_logs",
    data: {
      target_environment,
      log_type,
      lines_returned: entries.length,
      entries,
      log_path: logPath,
    },
    error: null,
    meta: { latency_ms: Date.now() - startedAt, safety_level: "A", delivery_mechanism: "ssh_exec" },
  };
}
