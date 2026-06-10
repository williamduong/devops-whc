export type ReleaseIntent = "refresh" | "deploy" | "promote" | "migrate" | "recover";

export type SourceKind = "full_site" | "partial_content" | "package_only" | "artifact_first" | "monorepo_slice";

export type DeployUnit = "raw_source" | "build_artifact" | "package_bundle";

export interface SourceProfile {
  local_project_root?: string;
  local_app_path?: string;
  source_kind: SourceKind;
  deploy_unit: DeployUnit;
  build_command?: string;
  build_artifact_path?: string;
}

export type PipelineId = "P0" | "P1" | "P2" | "P2R" | "P3" | "P3D" | "P4" | "P5";

export type DeliveryMechanism = "read_probe" | "managed_sync" | "git_deploy" | "ssh_exec" | "file_transfer";
