import { SafetyLevel } from "../contracts/envelope";

export interface PolicyInput {
  toolName: string;
  mode: "read" | "write";
  safetyLevel: SafetyLevel;
  dryRun?: boolean;
  confirmed?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresConfirm: boolean;
  requiresDryRun: boolean;
  reason?: string;
  safetyLevel: SafetyLevel;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  if (input.mode === "read") {
    return {
      allowed: true,
      requiresConfirm: false,
      requiresDryRun: false,
      safetyLevel: input.safetyLevel,
    };
  }

  if (input.safetyLevel === "D") {
    const missingDryRun = !input.dryRun;
    const missingConfirm = !input.confirmed;

    if (missingDryRun || missingConfirm) {
      return {
        allowed: false,
        requiresConfirm: true,
        requiresDryRun: true,
        reason: "Level D operation requires both dry_run and explicit confirmation",
        safetyLevel: input.safetyLevel,
      };
    }
  }

  if (input.safetyLevel === "C" && !input.confirmed) {
    return {
      allowed: false,
      requiresConfirm: true,
      requiresDryRun: false,
      reason: "Level C operation requires explicit confirmation",
      safetyLevel: input.safetyLevel,
    };
  }

  return {
    allowed: true,
    requiresConfirm: input.safetyLevel === "B" || input.safetyLevel === "C" || input.safetyLevel === "D",
    requiresDryRun: input.safetyLevel === "D",
    safetyLevel: input.safetyLevel,
  };
}
