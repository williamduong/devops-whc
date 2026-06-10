import { z } from "zod";
import { AppConfig } from "../config/env";
import { PipelineId, ReleaseIntent, SourceProfile } from "../contracts/deployment";
import { ToolRequestEnvelope } from "../contracts/envelope";

const sourceProfileSchema = z.object({
  local_project_root: z.string().min(1).optional(),
  local_app_path: z.string().min(1).optional(),
  source_kind: z.enum(["full_site", "partial_content", "package_only", "artifact_first", "monorepo_slice"]),
  deploy_unit: z.enum(["raw_source", "build_artifact", "package_bundle"]),
  build_command: z.string().min(1).optional(),
  build_artifact_path: z.string().min(1).optional(),
});

const payloadSchema = z.object({
  target_environment: z.enum(["live", "staging", "auto"]).default("auto"),
  release_intent: z.enum(["refresh", "deploy", "promote", "migrate", "recover"]),
  pipeline_id: z.enum(["P0", "P1", "P2", "P2R", "P3", "P3D", "P4", "P5"]),
  source_profile: sourceProfileSchema,
});

const requestSchema = z.object({
  request_id: z.string().min(1),
  actor: z.object({
    kind: z.literal("copilot"),
    user_hint: z.string().min(1).optional(),
  }),
  dry_run: z.boolean().optional(),
  idempotency_key: z.string().min(1).optional(),
  payload: payloadSchema,
});

export type WhcCheckHealthPayload = z.infer<typeof payloadSchema>;
export type WhcCheckHealthRequest = ToolRequestEnvelope<WhcCheckHealthPayload>;

export function buildDefaultWhcCheckHealthPayload(config: AppConfig): WhcCheckHealthPayload {
  const releaseIntent: ReleaseIntent = config.sourceProfile.defaultReleaseIntent;
  const sourceProfile: SourceProfile = {
    local_project_root: config.sourceProfile.localProjectRoot,
    local_app_path: config.sourceProfile.localAppPath,
    source_kind: config.sourceProfile.sourceKind,
    deploy_unit: config.sourceProfile.deployUnit,
    build_command: config.sourceProfile.buildCommand,
    build_artifact_path: config.sourceProfile.buildArtifactPath,
  };

  const pipelineId: PipelineId = "P1";

  return {
    target_environment: "auto",
    release_intent: releaseIntent,
    pipeline_id: pipelineId,
    source_profile: sourceProfile,
  };
}

export function validateWhcCheckHealthRequest(input: unknown): WhcCheckHealthRequest {
  const parsed = requestSchema.safeParse(input);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR: ${issues}`);
  }

  return parsed.data;
}
