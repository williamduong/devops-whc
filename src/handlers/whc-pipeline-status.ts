import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { WhcPipelineStatusRequest } from "../schemas/whc-pipeline-status";
import { getPipelineStatusFile, getReleaseManifestFile, readPipelineStatus } from "../state/workspace-state";

export interface WhcPipelineStatusData {
  started: boolean;
  completed: boolean;
  status: "idle" | "in_progress" | "success" | "failure";
  tool: string;
  request_id: string;
  action_id?: string;
  target_environment?: string;
  pipeline_id?: string;
  release_intent?: string;
  started_at?: string;
  completed_at?: string;
  next_step?: string;
  error?: {
    code: string;
    message: string;
  } | null;
  artifacts: {
    state_file: string;
    manifest_file?: string;
    flow_log_file: string;
  };
}

export async function executeWhcPipelineStatus(
  config: AppConfig,
  request: WhcPipelineStatusRequest,
): Promise<ToolResponseEnvelope<WhcPipelineStatusData>> {
  const startedAt = Date.now();
  const rootDir = request.payload.workspace_root ?? process.cwd();
  const status = readPipelineStatus(rootDir);

  if (!status) {
    return {
      ok: true,
      action_id: randomUUID(),
      tool: "whc_pipeline_status",
      data: {
        started: false,
        completed: false,
        status: "idle",
        tool: "",
        request_id: "",
        next_step: "Run whc_prepare then a write tool to initialize pipeline state.",
        artifacts: {
          state_file: getPipelineStatusFile(rootDir),
          flow_log_file: config.flowLogPath ?? ".mcp/whc-mcp/logs/flow-events.jsonl",
        },
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "A",
        delivery_mechanism: "read_probe",
      },
    };
  }

  const statusRequestId = readString(status.request_id);
  const requestedId = request.payload.request_id;
  const effectiveId = requestedId && requestedId.length > 0 ? requestedId : statusRequestId;
  const manifestFile = effectiveId ? getReleaseManifestFile(rootDir, effectiveId) : undefined;

  return {
    ok: true,
    action_id: randomUUID(),
    tool: "whc_pipeline_status",
    data: {
      started: readBoolean(status.started),
      completed: readBoolean(status.completed),
      status: readStatus(status.status),
      tool: readString(status.tool),
      request_id: statusRequestId,
      action_id: readOptionalString(status.action_id),
      target_environment: readOptionalString(status.target_environment),
      pipeline_id: readOptionalString(status.pipeline_id),
      release_intent: readOptionalString(status.release_intent),
      started_at: readOptionalString(status.started_at),
      completed_at: readOptionalString(status.completed_at),
      next_step: readOptionalString(status.next_step),
      error: readError(status.error),
      artifacts: {
        state_file: getPipelineStatusFile(rootDir),
        manifest_file: manifestFile,
        flow_log_file: config.flowLogPath ?? ".mcp/whc-mcp/logs/flow-events.jsonl",
      },
    },
    error: null,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: "A",
      delivery_mechanism: "read_probe",
    },
  };
}

function readBoolean(input: unknown): boolean {
  return input === true;
}

function readString(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function readOptionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function readStatus(input: unknown): "idle" | "in_progress" | "success" | "failure" {
  if (input === "in_progress" || input === "success" || input === "failure") {
    return input;
  }
  return "idle";
}

function readError(input: unknown): { code: string; message: string } | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const code = readString((input as Record<string, unknown>).code);
  const message = readString((input as Record<string, unknown>).message);
  if (!code || !message) {
    return null;
  }
  return { code, message };
}
