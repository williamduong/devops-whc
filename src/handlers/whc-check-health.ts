import { randomUUID } from "node:crypto";
import { AppConfig } from "../config/env";
import { ToolResponseEnvelope } from "../contracts/envelope";
import { runConnectivityProbe, ConnectivityProbeReport } from "../probes/connectivity";
import {
  WhcCheckHealthRequest,
  buildDefaultWhcCheckHealthPayload,
  validateWhcCheckHealthRequest,
} from "../schemas/whc-check-health";

export interface WhcCheckHealthData {
  readiness: "ready" | "needs_fix" | "unknown";
  capabilities: ConnectivityProbeReport;
  paths: {
    prod: string;
    staging?: string;
  };
  warnings: string[];
}

export interface WhcCheckHealthHandlerDeps {
  probeRunner?: (config: AppConfig) => Promise<ConnectivityProbeReport>;
  actionIdFactory?: () => string;
}

/**
 * Pure executor: assumes request is already validated.
 * Used by the dispatcher (validate → policy → idempotency → execute → audit).
 */
export async function executeWhcCheckHealth(
  config: AppConfig,
  request: WhcCheckHealthRequest,
  deps: WhcCheckHealthHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcCheckHealthData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;
  const probeRunner = deps.probeRunner ?? runConnectivityProbe;

  try {
    const report = await probeRunner(config);
    const readiness = computeReadiness(report);
    const warnings = buildWarnings(report);

    return {
      ok: true,
      action_id: actionIdFactory(),
      tool: "whc_check_health",
      data: {
        readiness,
        capabilities: report,
        paths: {
          prod: config.paths.prod,
          staging: config.paths.staging,
        },
        warnings,
      },
      error: null,
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "A",
        workflow_mode: config.workflowMode,
        pipeline_id: request.payload.pipeline_id,
        release_intent: request.payload.release_intent,
        source_profile: request.payload.source_profile,
        delivery_mechanism: "read_probe",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown health-check error";

    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_check_health",
      data: null,
      error: {
        code: "UNKNOWN_UPSTREAM_ERROR",
        message,
        retryable: true,
      },
      meta: {
        latency_ms: Date.now() - startedAt,
        safety_level: "A",
        workflow_mode: config.workflowMode,
        pipeline_id: request.payload.pipeline_id,
        release_intent: request.payload.release_intent,
        source_profile: request.payload.source_profile,
        delivery_mechanism: "read_probe",
      },
    };
  }
}

/**
 * Standalone convenience wrapper: validates input then executes.
 * Used for direct CLI invocation without the dispatcher.
 */
export async function handleWhcCheckHealth(
  config: AppConfig,
  input: unknown,
  deps: WhcCheckHealthHandlerDeps = {},
): Promise<ToolResponseEnvelope<WhcCheckHealthData>> {
  const startedAt = Date.now();
  const actionIdFactory = deps.actionIdFactory ?? randomUUID;

  let request: WhcCheckHealthRequest;
  try {
    request = validateWhcCheckHealthRequest(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error";
    return {
      ok: false,
      action_id: actionIdFactory(),
      tool: "whc_check_health",
      data: null,
      error: { code: "VALIDATION_ERROR", message, retryable: false },
      meta: { latency_ms: Date.now() - startedAt, safety_level: "A" },
    };
  }

  return executeWhcCheckHealth(config, request, deps);
}

export function buildDefaultWhcCheckHealthRequest(config: AppConfig): WhcCheckHealthRequest {
  return {
    request_id: randomUUID(),
    actor: {
      kind: "copilot",
      user_hint: "local-cli",
    },
    payload: buildDefaultWhcCheckHealthPayload(config),
  };
}

function computeReadiness(report: ConnectivityProbeReport): "ready" | "needs_fix" | "unknown" {
  if (report.uapi.ok && report.ssh.ok) {
    return "ready";
  }

  if (!report.uapi.ok || !report.ssh.ok) {
    return "needs_fix";
  }

  return "unknown";
}

function buildWarnings(report: ConnectivityProbeReport): string[] {
  const warnings: string[] = [];

  if (!report.uapi.ok) {
    warnings.push(`UAPI connectivity issue: ${report.uapi.message}`);
  }

  if (!report.ssh.ok) {
    warnings.push(`Production SSH issue: ${report.ssh.message}`);
  }

  if (!report.sshEnvironments.staging.ok) {
    warnings.push(`Staging SSH issue: ${report.sshEnvironments.staging.message}`);
  }

  if (!report.wpcli.prod.available) {
    warnings.push(`WP-CLI unavailable on production: ${report.wpcli.prod.message}`);
  }

  if (!report.wpcli.staging.available) {
    warnings.push(`WP-CLI unavailable on staging: ${report.wpcli.staging.message}`);
  }

  return warnings;
}
