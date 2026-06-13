import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWhcRollbackRequest } from "../src/schemas/whc-rollback";
import { executeWhcRollback } from "../src/handlers/whc-rollback";
import { WhcUapiClient } from "../src/clients/whc-uapi-client";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_deploy" as const,
  domains: {},
  paths: { prod: "/home/user/public_html", staging: "/home/user/staging" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: { requireStagingConfirm: true, warnDynamicDataSync: true },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "user", privateKeyPath: "C:/fake/key" },
    staging: { host: "srv44.swhc.ca", port: 27, username: "user", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function mockUapi(ok: boolean): WhcUapiClient {
  return {
    triggerDeployment: async () => ({
      ok,
      latencyMs: 5,
      deployment_id: ok ? "dep-rollback" : undefined,
      message: ok ? "ok" : "failed",
    }),
  } as unknown as WhcUapiClient;
}

describe("whc_rollback schema", () => {
  it("requires rollback_branch for git_branch mode", () => {
    expect(() =>
      validateWhcRollbackRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-1",
        payload: {
          target_environment: "live",
          rollback_mode: "git_branch",
          reason: "recover",
        },
      }),
    ).toThrow(/rollback_branch/);
  });

  it("accepts valid request", () => {
    const req = validateWhcRollbackRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      dry_run: true,
      confirmed: true,
      idempotency_key: "idem-1",
      payload: {
        target_environment: "live",
        rollback_mode: "git_branch",
        rollback_branch: "rollback/main",
        reason: "recover",
      },
    });
    expect(req.payload.rollback_mode).toBe("git_branch");
  });
});

describe("executeWhcRollback", () => {
  it("blocks when verify chain is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-rollback-missing-chain-"));
    process.chdir(root);

    const result = await executeWhcRollback(
      baseConfig,
      validateWhcRollbackRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-1",
        payload: {
          target_environment: "live",
          rollback_mode: "git_branch",
          rollback_branch: "rollback/main",
          reason: "recover",
        },
      }),
      { uapiClient: mockUapi(true) },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("returns preview when dry_run=true and verify chain PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-rollback-preview-"));
    process.chdir(root);

    const reportsDir = join(root, ".whc", "state", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, "rel-1.verify-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({ release_id: "rel-1", final_status: "PASS" }, null, 2),
      "utf8",
    );

    const result = await executeWhcRollback(
      baseConfig,
      validateWhcRollbackRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-1",
        payload: {
          target_environment: "live",
          rollback_mode: "git_branch",
          rollback_branch: "rollback/main",
          reason: "recover",
          verify_release_id: "rel-1",
          verify_report_path: reportPath,
        },
      }),
      { uapiClient: mockUapi(true) },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.rollback_status).toBe("preview");
    expect(result.data?.verify_chain.accepted).toBe(true);
  });

  it("executes git_branch rollback when dry_run=false and verify chain PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-rollback-exec-"));
    process.chdir(root);

    const reportsDir = join(root, ".whc", "state", "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, "rel-2.verify-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({ release_id: "rel-2", final_status: "PASS" }, null, 2),
      "utf8",
    );

    const result = await executeWhcRollback(
      baseConfig,
      validateWhcRollbackRequest({
        request_id: "r2",
        actor: { kind: "copilot" },
        dry_run: false,
        confirmed: true,
        idempotency_key: "idem-2",
        payload: {
          target_environment: "live",
          rollback_mode: "git_branch",
          rollback_branch: "rollback/main",
          reason: "recover",
          verify_release_id: "rel-2",
          verify_report_path: reportPath,
        },
      }),
      { uapiClient: mockUapi(true) },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.rollback_status).toBe("executed");
  });
});
