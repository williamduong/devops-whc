import { SafetyLevel } from "../contracts/envelope";

export type ToolMode = "read" | "write";

export interface ToolDefinition {
  name: string;
  mode: ToolMode;
  safetyLevel: SafetyLevel;
  description: string;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  whc_prepare: {
    name: "whc_prepare",
    mode: "write",
    safetyLevel: "B",
    description: "Initialize hidden workspace state and validate deploy readiness",
  },
  whc_setup_remote: {
    name: "whc_setup_remote",
    mode: "write",
    safetyLevel: "C",
    description: "Create cPanel Git repository and return SSH remote URL",
  },
  whc_deploy: {
    name: "whc_deploy",
    mode: "write",
    safetyLevel: "C",
    description: "Trigger VersionControl::deployment for staging or production",
  },
  whc_ssh_exec: {
    name: "whc_ssh_exec",
    mode: "write",
    safetyLevel: "C",
    description: "Execute safe read/sync SSH command on WHC host through enforced policy",
  },
  whc_get_logs: {
    name: "whc_get_logs",
    mode: "read",
    safetyLevel: "A",
    description: "Fetch latest app logs from WHC server",
  },
  whc_db_backup: {
    name: "whc_db_backup",
    mode: "write",
    safetyLevel: "D",
    description: "Create remote compressed SQL backup with audit tracking",
  },
  whc_check_health: {
    name: "whc_check_health",
    mode: "read",
    safetyLevel: "A",
    description: "Collect disk usage, SSL expiry, and load summary",
  },
  whc_verify: {
    name: "whc_verify",
    mode: "read",
    safetyLevel: "A",
    description: "Run post-deploy DevOps verification based on release manifest",
  },
  whc_pipeline_status: {
    name: "whc_pipeline_status",
    mode: "read",
    safetyLevel: "A",
    description: "Read latest hidden pipeline status and artifact pointers",
  },
  whc_rollback: {
    name: "whc_rollback",
    mode: "write",
    safetyLevel: "D",
    description: "Execute guarded rollback with mandatory dry-run, confirmation, and verify-chain",
  },
};

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return TOOL_REGISTRY[toolName];
}
