import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateWhcPipelineStatusRequest } from "../src/schemas/whc-pipeline-status";
import { executeWhcPipelineStatus } from "../src/handlers/whc-pipeline-status";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_controlled" as const,
  domains: {},
  paths: { prod: "/home/prod/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: { requireStagingConfirm: true, warnDynamicDataSync: true },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

describe("whc_pipeline_status schema", () => {
  it("accepts minimal request", () => {
    const req = validateWhcPipelineStatusRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      payload: {},
    });

    expect(req.payload).toEqual({});
  });
});

describe("executeWhcPipelineStatus", () => {
  it("returns idle when state does not exist", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-pipe-idle-"));

    const result = await executeWhcPipelineStatus(
      baseConfig,
      validateWhcPipelineStatusRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { workspace_root: root },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("idle");
  });

  it("reads existing state file", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-pipe-active-"));
    const stateDir = join(root, ".mcp", "whc-mcp", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "pipeline-status.json"),
      JSON.stringify(
        {
          started: true,
          completed: false,
          status: "in_progress",
          tool: "whc_deploy",
          request_id: "req-42",
          next_step: "Wait for completion",
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await executeWhcPipelineStatus(
      baseConfig,
      validateWhcPipelineStatusRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { workspace_root: root },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("in_progress");
    expect(result.data?.request_id).toBe("req-42");
  });
});
