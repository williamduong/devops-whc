import { z } from "zod";
import { AppConfig } from "../config/env";
import { PipelineId, ReleaseIntent, SourceProfile } from "../contracts/deployment";
import { ToolRequestEnvelope } from "../contracts/envelope";
import { sourceProfileSchema } from "./whc-setup-remote";

const payloadSchema = z.object({
  workflow_mode: z.enum(["git_deploy", "ssh_scp_wpcli"]),
  target_environment: z.enum(["live", "staging"]),
  release_intent: z.enum(["refresh", "deploy", "promote", "migrate", "recover"]),
  pipeline_id: z.enum(["P0", "P1", "P2", "P2R", "P3", "P3D", "P4", "P5"]),
  source_profile: sourceProfileSchema,

  // sync fields
  direction: z.enum(["live_to_staging", "staging_to_live"]).optional(),
  sync_scope: z.enum(["files", "database", "everything"]).optional(),

  backup_reference: z.string().min(1).optional(),
  allow_emergency_without_backup: z.boolean().optional(),
  verify_after_deploy: z.boolean().optional(),
  auto_rollback_on_verify_failure: z.boolean().optional(),
  lock_key: z.string().min(1).optional(),
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  dry_run: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  idempotency_key: z.string().min(1),
  payload: payloadSchema,
});

export type WhcDeployPayload = z.infer<typeof payloadSchema>;
export type WhcDeployRequest = ToolRequestEnvelope<WhcDeployPayload>;

export function buildDefaultWhcDeployPayload(config: AppConfig): WhcDeployPayload {
  const releaseIntent: ReleaseIntent = config.sourceProfile.defaultReleaseIntent;
  const sourceProfile: SourceProfile = {
    local_project_root: config.sourceProfile.localProjectRoot,
    local_app_path: config.sourceProfile.localAppPath,
    source_kind: config.sourceProfile.sourceKind,
    deploy_unit: config.sourceProfile.deployUnit,
    build_command: config.sourceProfile.buildCommand,
    build_artifact_path: config.sourceProfile.buildArtifactPath,
  };
  const pipelineId: PipelineId = "P3";

  return {
    workflow_mode: config.workflowMode,
    target_environment: "live",
    release_intent: releaseIntent,
    pipeline_id: pipelineId,
    source_profile: sourceProfile,
    direction: "staging_to_live",
    sync_scope: "files",
  };
}

export function validateWhcDeployRequest(input: unknown): WhcDeployRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }
  return parsed.data;
}
