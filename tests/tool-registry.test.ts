import { describe, expect, it } from "vitest";
import { TOOL_REGISTRY, getToolDefinition } from "../src/registry/tool-registry";

describe("tool registry", () => {
  it("contains all current tools", () => {
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(10);
    expect(getToolDefinition("whc_prepare")?.mode).toBe("write");
    expect(getToolDefinition("whc_setup_remote")?.mode).toBe("write");
    expect(getToolDefinition("whc_check_health")?.safetyLevel).toBe("A");
    expect(getToolDefinition("whc_verify")?.mode).toBe("read");
    expect(getToolDefinition("whc_pipeline_status")?.safetyLevel).toBe("A");
    expect(getToolDefinition("whc_rollback")?.safetyLevel).toBe("D");
  });
});