import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { FileAuditLogger } from "../src/audit/audit-logger";

describe("FileAuditLogger", () => {
  it("writes newline-delimited JSON entries", () => {
    const root = mkdtempSync(join(tmpdir(), "whc-audit-"));
    const logPath = join(root, "logs", "flow-events.jsonl");
    const logger = new FileAuditLogger(logPath);

    logger.log({
      actionId: "action-1",
      tool: "whc_deploy",
      status: "success",
      timestamp: "2026-01-01T00:00:00.000Z",
      details: { pipeline_id: "P3D", api_token: "super-secret" },
    });

    const content = readFileSync(logPath, "utf8").trim();
    expect(content.length).toBeGreaterThan(0);
    const parsed = JSON.parse(content) as { details?: Record<string, string> };
    expect(parsed.details?.pipeline_id).toBe("P3D");
    expect(parsed.details?.api_token).toBe("[REDACTED]");
  });
});
