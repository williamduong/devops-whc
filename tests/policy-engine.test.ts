import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/policy/policy-engine";

describe("evaluatePolicy", () => {
  it("allows read operations without confirmation", () => {
    const decision = evaluatePolicy({
      toolName: "whc_check_health",
      mode: "read",
      safetyLevel: "A",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirm).toBe(false);
  });

  it("blocks level C write without confirmation", () => {
    const decision = evaluatePolicy({
      toolName: "whc_deploy",
      mode: "write",
      safetyLevel: "C",
      confirmed: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/requires explicit confirmation/i);
  });

  it("blocks level D write without dry run", () => {
    const decision = evaluatePolicy({
      toolName: "whc_ssh_exec",
      mode: "write",
      safetyLevel: "D",
      confirmed: true,
      dryRun: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresDryRun).toBe(true);
  });

  it("blocks level D rollback without confirmation", () => {
    const decision = evaluatePolicy({
      toolName: "whc_rollback",
      mode: "write",
      safetyLevel: "D",
      dryRun: true,
      confirmed: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.requiresConfirm).toBe(true);
  });
});
