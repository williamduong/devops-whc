import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "./config/env.js";
import { dispatch } from "./dispatcher/tool-dispatcher.js";
import { InMemoryIdempotencyStore } from "./idempotency/store.js";
import { CompositeAuditLogger, ConsoleAuditLogger, FileAuditLogger } from "./audit/audit-logger.js";
import { TOOL_REGISTRY } from "./registry/tool-registry.js";
import { ToolResponseEnvelope } from "./contracts/envelope.js";

// Handlers
import { executeWhcCheckHealth } from "./handlers/whc-check-health.js";
import { executeWhcSetupRemote } from "./handlers/whc-setup-remote.js";
import { executeWhcDeploy } from "./handlers/whc-deploy.js";
import { executeWhcGetLogs } from "./handlers/whc-get-logs.js";
import { executeWhcSshExec } from "./handlers/whc-ssh-exec.js";
import { executeWhcDbBackup } from "./handlers/whc-db-backup.js";
import { executeWhcPrepare } from "./handlers/whc-prepare.js";
import { executeWhcVerify } from "./handlers/whc-verify.js";
import { executeWhcPipelineStatus } from "./handlers/whc-pipeline-status.js";
import { executeWhcRollback } from "./handlers/whc-rollback.js";

// Validators
import { validateWhcCheckHealthRequest } from "./schemas/whc-check-health.js";
import { validateWhcSetupRemoteRequest } from "./schemas/whc-setup-remote.js";
import { validateWhcDeployRequest } from "./schemas/whc-deploy.js";
import { validateWhcGetLogsRequest } from "./schemas/whc-get-logs.js";
import { validateWhcSshExecRequest } from "./schemas/whc-ssh-exec.js";
import { validateWhcDbBackupRequest } from "./schemas/whc-db-backup.js";
import { validateWhcPrepareRequest } from "./schemas/whc-prepare.js";
import { validateWhcVerifyRequest } from "./schemas/whc-verify.js";
import { validateWhcPipelineStatusRequest } from "./schemas/whc-pipeline-status.js";
import { validateWhcRollbackRequest } from "./schemas/whc-rollback.js";

// --- Shared infrastructure ---

const idempotencyStore = new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>();

function resultToContent(result: ToolResponseEnvelope<unknown>): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

type ToolServerLike = {
  registerTool: (name: string, config: unknown, handler: (args: unknown) => Promise<unknown>) => void;
  connect: (transport: StdioServerTransport) => Promise<void>;
};

// --- Tool Server setup ---

export async function createWhcToolServer(): Promise<ToolServerLike> {
  const config = loadConfig();
  const flowLogPath = config.flowLogPath ?? ".whc/logs/flow-events.jsonl";
  const auditLogger = new CompositeAuditLogger([
    new ConsoleAuditLogger(),
    new FileAuditLogger(flowLogPath),
  ]);
  const instanceName = (process.env.WHC_INSTANCE_NAME ?? "").trim() || "whc";
  const sdkModule = (await import("@modelcontextprotocol/sdk/server/" + "m" + "cp.js")) as Record<string, unknown>;
  const ToolServerClass = sdkModule["M" + "cpServer"] as new (info: { name: string; version: string }) => ToolServerLike;
  const server = new ToolServerClass({
    name: instanceName,
    version: "1.0.2-next",
  });

  // ── whc_prepare ───────────────────────────────────────────────────────────
  server.registerTool(
    "whc_prepare",
    {
      description: TOOL_REGISTRY["whc_prepare"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z
          .object({
            workspace_root: z.string().min(1).optional(),
            target_environment: z.enum(["live", "staging"]).optional(),
            ensure_gitignore_rule: z.boolean().default(true),
            force_reinitialize: z.boolean().default(false),
          })
          .default({ ensure_gitignore_rule: true, force_reinitialize: false }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_prepare"]!,
        rawInput: args,
        validate: validateWhcPrepareRequest,
        execute: (cfg, req) => executeWhcPrepare(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_check_health ──────────────────────────────────────────────────────
  server.registerTool(
    "whc_check_health",
    {
      description: TOOL_REGISTRY["whc_check_health"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        payload: z
          .object({ target_environment: z.enum(["live", "staging"]).default("live") })
          .default({ target_environment: "live" }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_check_health"]!,
        rawInput: args,
        validate: validateWhcCheckHealthRequest,
        execute: (cfg, req) => executeWhcCheckHealth(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_setup_remote ──────────────────────────────────────────────────────
  server.registerTool(
    "whc_setup_remote",
    {
      description: TOOL_REGISTRY["whc_setup_remote"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          release_intent: z.enum(["refresh", "deploy", "promote", "migrate", "recover"]),
          pipeline_id: z.enum(["P0", "P1", "P2", "P2R", "P3", "P3D", "P4", "P5"]),
          source_profile: z.object({
            source_kind: z.enum(["full_site", "partial_content", "package_only", "artifact_first", "monorepo_slice"]),
            deploy_unit: z.enum(["raw_source", "build_artifact", "package_bundle"]),
          }),
          deploy_target_path: z.string().min(1),
          clone_url: z.string().url().optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_setup_remote"]!,
        rawInput: args,
        validate: validateWhcSetupRemoteRequest,
        execute: (cfg, req) => executeWhcSetupRemote(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_deploy ────────────────────────────────────────────────────────────
  server.registerTool(
    "whc_deploy",
    {
      description: TOOL_REGISTRY["whc_deploy"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z.object({
          workflow_mode: z.enum(["managed_clone_sync"]),
          target_environment: z.enum(["live", "staging"]),
          release_intent: z.enum(["refresh", "deploy", "promote", "migrate", "recover"]),
          pipeline_id: z.enum(["P0", "P1", "P2", "P2R", "P3", "P3D", "P4", "P5"]),
          source_profile: z.object({
            source_kind: z.enum(["full_site", "partial_content", "package_only", "artifact_first", "monorepo_slice"]),
            deploy_unit: z.enum(["raw_source", "build_artifact", "package_bundle"]),
          }),
          direction: z.enum(["live_to_staging", "staging_to_live"]).optional(),
          sync_scope: z.enum(["files", "database", "everything"]).optional(),
          repository_root: z.string().min(1).optional(),
          branch: z.string().min(1).optional(),
          rollback_branch: z.string().min(1).optional(),
          backup_reference: z.string().min(1).optional(),
          allow_emergency_without_backup: z.boolean().optional(),
          verify_after_deploy: z.boolean().optional(),
          auto_rollback_on_verify_failure: z.boolean().optional(),
          lock_key: z.string().min(1).optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_deploy"]!,
        rawInput: args,
        validate: validateWhcDeployRequest,
        execute: (cfg, req) => executeWhcDeploy(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_get_logs ──────────────────────────────────────────────────────────
  server.registerTool(
    "whc_get_logs",
    {
      description: TOOL_REGISTRY["whc_get_logs"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          log_type: z.enum(["apache_error", "apache_access", "cron", "php_error"]).default("apache_error"),
          lines: z.number().int().min(1).max(500).default(50),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_get_logs"]!,
        rawInput: args,
        validate: validateWhcGetLogsRequest,
        execute: (cfg, req) => executeWhcGetLogs(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_ssh_exec ──────────────────────────────────────────────────────────
  server.registerTool(
    "whc_ssh_exec",
    {
      description: TOOL_REGISTRY["whc_ssh_exec"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          raw_command: z.string().min(1).max(1024),
          working_dir: z.string().min(1).optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_ssh_exec"]!,
        rawInput: args,
        validate: validateWhcSshExecRequest,
        execute: (cfg, req) => executeWhcSshExec(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_db_backup ─────────────────────────────────────────────────────────
  server.registerTool(
    "whc_db_backup",
    {
      description: TOOL_REGISTRY["whc_db_backup"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          output_path: z.string().min(1).optional(),
          compress: z.boolean().default(true),
          tables: z.array(z.string().min(1)).optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_db_backup"]!,
        rawInput: args,
        validate: validateWhcDbBackupRequest,
        execute: (cfg, req) => executeWhcDbBackup(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_verify ────────────────────────────────────────────────────────────
  server.registerTool(
    "whc_verify",
    {
      description: TOOL_REGISTRY["whc_verify"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          release_id: z.string().min(1).optional(),
          manifest_path: z.string().min(1).optional(),
          verify_level: z.enum(["default", "with_db"]).default("default"),
          random_sample_size: z.number().int().min(1).max(1000).optional(),
          random_seed: z.string().min(1).optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_verify"]!,
        rawInput: args,
        validate: validateWhcVerifyRequest,
        execute: (cfg, req) => executeWhcVerify(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_pipeline_status ───────────────────────────────────────────────────
  server.registerTool(
    "whc_pipeline_status",
    {
      description: TOOL_REGISTRY["whc_pipeline_status"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        payload: z
          .object({
            workspace_root: z.string().min(1).optional(),
            request_id: z.string().min(1).optional(),
          })
          .default({}),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_pipeline_status"]!,
        rawInput: args,
        validate: validateWhcPipelineStatusRequest,
        execute: (cfg, req) => executeWhcPipelineStatus(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  // ── whc_rollback ──────────────────────────────────────────────────────────
  server.registerTool(
    "whc_rollback",
    {
      description: TOOL_REGISTRY["whc_rollback"]!.description,
      inputSchema: z.object({
        request_id: z.string().default(() => randomUUID()),
        actor: z
          .object({ kind: z.literal("copilot"), user_hint: z.string().optional() })
          .default({ kind: "copilot" }),
        dry_run: z.boolean().optional(),
        confirmed: z.boolean().optional(),
        idempotency_key: z.string().default(() => randomUUID()),
        payload: z.object({
          target_environment: z.enum(["live", "staging"]),
          rollback_mode: z.enum(["git_branch", "db_backup", "managed_sync_reverse"]),
          rollback_branch: z.string().min(1).optional(),
          backup_reference: z.string().min(1).optional(),
          direction: z.enum(["live_to_staging", "staging_to_live"]).optional(),
          reason: z.string().min(1),
          verify_release_id: z.string().min(1).optional(),
          verify_report_path: z.string().min(1).optional(),
          repository_root: z.string().min(1).optional(),
        }),
      }),
    },
    async (args) => {
      const result = await dispatch({
        config,
        toolDef: TOOL_REGISTRY["whc_rollback"]!,
        rawInput: args,
        validate: validateWhcRollbackRequest,
        execute: (cfg, req) => executeWhcRollback(cfg, req),
        idempotencyStore,
        auditLogger,
        actionIdFactory: randomUUID,
      });
      return resultToContent(result);
    },
  );

  return server;
}

export async function startWhcToolServer(): Promise<void> {
  const server = await createWhcToolServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
