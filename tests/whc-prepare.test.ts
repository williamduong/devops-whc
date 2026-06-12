import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWhcPrepareRequest } from "../src/schemas/whc-prepare";
import { executeWhcPrepare } from "../src/handlers/whc-prepare";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "managed_clone_sync" as const,
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

const REQUIRED_KEYS = [
  "WHC_API_TOKEN",
  "WHC_USER",
  "WHC_HOST",
  "WHC_PROD_SSH_HOST",
  "WHC_PROD_SSH_USERNAME",
  "WHC_PROD_SSH_PRIVATE_KEY_PATH",
];

const originalEnv: Record<string, string | undefined> = {};

for (const key of REQUIRED_KEYS) {
  originalEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of REQUIRED_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("whc_prepare schema", () => {
  it("rejects request missing idempotency_key", () => {
    expect(() =>
      validateWhcPrepareRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: {},
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("accepts valid request with defaults", () => {
    const req = validateWhcPrepareRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      idempotency_key: "idem-1",
      payload: {},
    });
    expect(req.payload.ensure_gitignore_rule).toBe(true);
    expect(req.payload.force_reinitialize).toBe(false);
  });
});

describe("executeWhcPrepare", () => {
  it("creates .whc state and pipeline status file", async () => {
    for (const key of REQUIRED_KEYS) {
      process.env[key] = "configured";
    }

    const root = mkdtempSync(join(tmpdir(), "whc-prepare-"));
    const result = await executeWhcPrepare(
      baseConfig,
      validateWhcPrepareRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        idempotency_key: "idem-1",
        payload: { workspace_root: root },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.data?.state_root).toBe(".whc");
    expect(result.data?.pipeline_status_file).toContain(".whc");

    const statusRaw = readFileSync(result.data!.pipeline_status_file, "utf8");
    const status = JSON.parse(statusRaw) as { status: string };
    expect(status.status).toBe("idle");
  });
});
