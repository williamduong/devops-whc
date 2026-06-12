export type SafetyLevel = "A" | "B" | "C" | "D";

import { DeliveryMechanism, PipelineId, ReleaseIntent, SourceProfile } from "./deployment";

export { DeliveryMechanism, PipelineId, ReleaseIntent, SourceProfile };

export type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TEMPORARY_UPSTREAM_ERROR"
  | "BUSINESS_POLICY_BLOCKED"
  | "UNKNOWN_UPSTREAM_ERROR";

export interface ToolRequestEnvelope<TPayload> {
  request_id: string;
  actor: {
    kind: "copilot";
    user_hint?: string;
  };
  dry_run?: boolean;
  confirmed?: boolean;
  idempotency_key?: string;
  payload: TPayload;
}

export interface ToolError {
  code: ToolErrorCode;
  http_status?: number;
  message: string;
  retryable: boolean;
  retry_after_ms?: number;
}

export interface ToolResponseEnvelope<TData> {
  ok: boolean;
  action_id: string;
  tool: string;
  data: TData | null;
  error: ToolError | null;
  meta: {
    latency_ms?: number;
    retry_count?: number;
    safety_level: SafetyLevel;
    workflow_mode?: "managed_clone_sync";
    pipeline_id?: PipelineId;
    release_intent?: ReleaseIntent;
    source_profile?: SourceProfile;
    delivery_mechanism?: DeliveryMechanism;
  };
}
