import { z } from "zod";
import { AppConfig } from "../config/env";
import { PipelineId, ReleaseIntent, SourceProfile } from "../contracts/deployment";
import { ToolRequestEnvelope } from "../contracts/envelope";

export const sourceProfileSchema = z.object({
  local_project_root: z.string().min(1).optional(),
  local_app_path: z.string().min(1).optional(),
  source_kind: z.enum(["full_site", "partial_content", "package_only", "artifact_first", "monorepo_slice"]),
  deploy_unit: z.enum(["raw_source", "build_artifact", "package_bundle"]),
  build_command: z.string().min(1).optional(),
  build_artifact_path: z.string().min(1).optional(),
});

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging"]),
  release_intent: z.enum(["refresh", "deploy", "promote", "migrate", "recover"]),
  pipeline_id: z.enum(["P0", "P1", "P2", "P2R", "P3", "P3D", "P4", "P5"]),
  source_profile: sourceProfileSchema,
  deploy_target_path: z.string().min(1),
  clone_url: z.string().url().optional(),
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

export type WhcSetupRemotePayload = z.infer<typeof payloadSchema>;
export type WhcSetupRemoteRequest = ToolRequestEnvelope<WhcSetupRemotePayload>;

export function buildDefaultWhcSetupRemotePayload(config: AppConfig, deployTargetPath: string): WhcSetupRemotePayload {
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
    target_environment: "live",
    release_intent: releaseIntent,
    pipeline_id: pipelineId,
    source_profile: sourceProfile,
    deploy_target_path: deployTargetPath,
  };
}

export function validateWhcSetupRemoteRequest(input: unknown): WhcSetupRemoteRequest {
  const parsed = requestSchema.safeParse(input);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }

  return parsed.data;
}
