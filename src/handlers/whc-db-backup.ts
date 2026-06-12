import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcDbBackupRequest } from "../schemas/whc-db-backup";
import { WhcSshClient, SshExecResult } from "../clients/ssh-client";

export interface WhcDbBackupData {
  target_environment: string;
  dump_path: string;
  compressed: boolean;
  tables?: string[];
  size_hint?: string;
  checksum?: string;
}

export interface WhcDbBackupHandlerDeps {
  sshClient?: WhcSshClient;
  actionIdFactory?: () => string;
}

function buildDumpPath(outputPath: string | undefined, env: string, compress: boolean): string {
  if (outputPath) return outputPath;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = compress ? ".sql.gz" : ".sql";
  return `~/db-backups/${env}-${ts}${ext}`;
}

function buildWpCliCommand(dumpPath: string, compress: boolean, tables?: string[]): string {
  const tableFlag = tables && tables.length > 0 ? ` --tables=${tables.join(",")}` : "";
  const compressFlag = compress ? " | gzip" : "";

  if (compress) {
    return `wp db export -${tableFlag} 2>/dev/null${compressFlag} > ${dumpPath}`;
  }
  return `wp db export ${dumpPath}${tableFlag}`;
}

export async function executeWhcDbBackup(
  config: AppConfig,
  request: WhcDbBackupRequest,
  deps: WhcDbBackupHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcDbBackupData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const sshClient = deps.sshClient ?? new WhcSshClient(config);

  const { target_environment, output_path, compress, tables } = request.payload;
  const dumpPath = buildDumpPath(output_path, target_environment, compress);

  // Dry run: preview command without executing
  if (request.dry_run) {
    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_db_backup",
      data: {
        target_environment,
        dump_path: dumpPath,
        compressed: compress,
        tables,
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "D",
        delivery_mechanism: "ssh_exec",
      },
    };
  }

  // Resolve SSH target
  let execResult: SshExecResult;
  const ensureDirCmd = `mkdir -p $(dirname ${dumpPath})`;
  const backupCmd = buildWpCliCommand(dumpPath, compress, tables);
  const sizeCmd = `du -sh ${dumpPath} 2>/dev/null | cut -f1 || echo 'unknown'`;
  // Ensure backup dir exists, then run wp db export, then get size
  const fullCommand = `${ensureDirCmd} && ${backupCmd} && ${sizeCmd}`;

  try {
    if (target_environment === "staging") {
      const stagingTarget = config.sshTargets.staging;
      if (!stagingTarget) {
        return buildErrorResponse(actionIdFactory(), startedAt, "BUSINESS_POLICY_BLOCKED", "Staging SSH target is not configured.");
      }
      if (!stagingTarget.privateKeyPath) {
        return buildErrorResponse(actionIdFactory(), startedAt, "BUSINESS_POLICY_BLOCKED", "whc_db_backup requires key-based SSH auth on staging.");
      }
      execResult = await sshClient.execWithKey(
        {
          host: stagingTarget.host,
          port: stagingTarget.port,
          username: stagingTarget.username,
          privateKeyPath: stagingTarget.privateKeyPath,
        },
        fullCommand,
      );
    } else {
      execResult = await sshClient.execWithKey(config.sshTargets.prod, fullCommand);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSH exec failed";
    return buildErrorResponse(actionIdFactory(), startedAt, "AUTH_ERROR", message);
  }

  if (!execResult.ok) {
    return buildErrorResponse(
      actionIdFactory(),
      startedAt,
      "TEMPORARY_UPSTREAM_ERROR",
      execResult.message || execResult.stderr || "wp db export failed",
    );
  }

  const sizeHint = execResult.stdout.split("\n").filter((l) => l.trim().length > 0).pop()?.trim();

  return {
    ok: true,
    action_id: actionIdFactory(),
    tool: "whc_db_backup",
    data: {
      target_environment,
      dump_path: dumpPath,
      compressed: compress,
      tables,
      size_hint: sizeHint,
    },
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "D",
      delivery_mechanism: "ssh_exec",
    },
  };
}

function buildErrorResponse(
  actionId: string,
  startedAt: number,
  code: "BUSINESS_POLICY_BLOCKED" | "AUTH_ERROR" | "TEMPORARY_UPSTREAM_ERROR",
  message: string,
): ToolResponseEnvelope<WhcDbBackupData> {
  return {
    ok: false,
    action_id: actionId,
    tool: "whc_db_backup",
    data: null,
    error: { code, message, retryable: code === "TEMPORARY_UPSTREAM_ERROR" },
    meta: { latency_ms: Date.now() - startedAt, safety_level: "D" },
  };
}
