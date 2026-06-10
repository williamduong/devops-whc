import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { SafetyLevel, ToolRequestEnvelope, ToolResponseEnvelope, ToolError } from "../contracts/envelope";
import { ToolDefinition } from "../registry/tool-registry";
import { evaluatePolicy } from "../policy/policy-engine";
import { IdempotencyStore } from "../idempotency/store";
import { AuditLogger } from "../audit/audit-logger";
import { writePipelineStartState, writePipelineEndState } from "../state/workspace-state";

export type ExecuteFn<TPayload, TData> = (
  config: AppConfig,
  request: ToolRequestEnvelope<TPayload>,
) => Promise<ToolResponseEnvelope<TData>>;

export interface DispatchOptions<TPayload, TData> {
  config: AppConfig;
  toolDef: ToolDefinition;
  rawInput: unknown;
  validate: (input: unknown) => ToolRequestEnvelope<TPayload>;
  execute: ExecuteFn<TPayload, TData>;
  idempotencyStore: IdempotencyStore<ToolResponseEnvelope<TData>>;
  auditLogger: AuditLogger;
  actionIdFactory?: () => string;
}

export async function dispatch<TPayload, TData>(
  options: DispatchOptions<TPayload, TData>,
): Promise<ToolResponseEnvelope<TData>> {
  const {
    config,
    toolDef,
    rawInput,
    validate,
    execute,
    idempotencyStore,
    auditLogger,
    actionIdFactory = randomUUID,
  } = options;

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();

  // Step 1: Validate input schema
  let request: ToolRequestEnvelope<TPayload>;
  try {
    request = validate(rawInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    return buildErrorEnvelope<TData>(toolDef.name, actionIdFactory(), startedAt, toolDef.safetyLevel, {
      code: "VALIDATION_ERROR",
      message,
      retryable: false,
    });
  }

  // Step 2: Policy evaluation
  const policy = evaluatePolicy({
    toolName: toolDef.name,
    mode: toolDef.mode,
    safetyLevel: toolDef.safetyLevel,
    dryRun: request.dry_run,
    confirmed: request.confirmed,
  });

  if (!policy.allowed) {
    return buildErrorEnvelope<TData>(toolDef.name, actionIdFactory(), startedAt, toolDef.safetyLevel, {
      code: "BUSINESS_POLICY_BLOCKED",
      message: policy.reason ?? "Operation blocked by safety policy",
      retryable: false,
    });
  }

  // Step 3: Idempotency check (write operations only)
  let idempotencyKey: string | undefined;
  let payloadHash: string | undefined;

  if (toolDef.mode === "write" && request.idempotency_key) {
    idempotencyKey = request.idempotency_key;
    payloadHash = hashPayload(request.payload);
    const existing = idempotencyStore.get(idempotencyKey);
    if (existing && existing.payloadHash === payloadHash) {
      return existing.response;
    }
  }

  // Step 4: Execute handler
  let response: ToolResponseEnvelope<TData>;

  if (toolDef.mode === "write" && process.env.NODE_ENV !== "test") {
    writePipelineStartState({
      rootDir: process.cwd(),
      toolName: toolDef.name,
      requestId: request.request_id,
      targetEnvironment: extractStringField(request.payload, "target_environment"),
      pipelineId: extractStringField(request.payload, "pipeline_id"),
      releaseIntent: extractStringField(request.payload, "release_intent"),
      startedAtIso,
    });
  }

  try {
    response = await execute(config, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution error";
    response = buildErrorEnvelope<TData>(toolDef.name, actionIdFactory(), startedAt, toolDef.safetyLevel, {
      code: "UNKNOWN_UPSTREAM_ERROR",
      message,
      retryable: true,
    });
  }

  if (toolDef.mode === "write" && process.env.NODE_ENV !== "test") {
    const data = (response.data ?? null) as Record<string, unknown> | null;
    const processTracking = data && typeof data === "object" ? (data["process_tracking"] as Record<string, unknown> | undefined) : undefined;
    const nextStep = processTracking && typeof processTracking["next_step"] === "string" ? (processTracking["next_step"] as string) : undefined;

    writePipelineEndState(
      {
        rootDir: process.cwd(),
        toolName: toolDef.name,
        requestId: request.request_id,
        targetEnvironment: extractStringField(request.payload, "target_environment"),
        pipelineId: extractStringField(request.payload, "pipeline_id"),
        releaseIntent: extractStringField(request.payload, "release_intent"),
        startedAtIso,
      },
      {
        ok: response.ok,
        actionId: response.action_id,
        nextStep,
        errorCode: response.error?.code,
        errorMessage: response.error?.message,
      },
    );
  }

  // Step 5: Audit write operations
  if (toolDef.mode === "write") {
    auditLogger.log({
      actionId: response.action_id,
      tool: toolDef.name,
      status: response.ok ? "success" : "failure",
      timestamp: new Date().toISOString(),
      details: {
        dry_run: request.dry_run ?? false,
        ok: response.ok,
        idempotency_key: idempotencyKey ?? "",
        request_id: request.request_id,
        target_environment: extractStringField(request.payload, "target_environment"),
        pipeline_id: extractStringField(request.payload, "pipeline_id"),
        release_intent: extractStringField(request.payload, "release_intent"),
      },
    });
  }

  // Step 6: Store idempotency record for successful writes
  if (toolDef.mode === "write" && idempotencyKey && payloadHash && response.ok) {
    idempotencyStore.set(idempotencyKey, {
      actionId: response.action_id,
      payloadHash,
      response,
    });
  }

  return response;
}

function buildErrorEnvelope<TData>(
  tool: string,
  actionId: string,
  startedAt: number,
  safetyLevel: SafetyLevel,
  error: ToolError,
): ToolResponseEnvelope<TData> {
  return {
    ok: false,
    action_id: actionId,
    tool,
    data: null,
    error,
    meta: {
      latency_ms: Date.now() - startedAt,
      safety_level: safetyLevel,
    },
  };
}

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function extractStringField(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}
