import { describe, expect, it } from "vitest";
import { validateWhcDbBackupRequest } from "../src/schemas/whc-db-backup";
import { executeWhcDbBackup } from "../src/handlers/whc-db-backup";
import { WhcSshClient, SshExecResult } from "../src/clients/ssh-client";

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

function mockSshClient(result: Partial<SshExecResult>): WhcSshClient {
  return {
    execWithKey: async () => ({
      ok: true,
      latencyMs: 10,
      stdout: "24M",
      stderr: "",
      message: "ok",
      ...result,
    }),
  } as unknown as WhcSshClient;
}

describe("whc_db_backup schema", () => {
  it("rejects request missing idempotency_key", () => {
    expect(() =>
      validateWhcDbBackupRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live" },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("accepts valid request with compress default", () => {
    const req = validateWhcDbBackupRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      confirmed: true,
      idempotency_key: "idem-1",
      payload: { target_environment: "live" },
    });
    expect(req.payload.compress).toBe(true);
  });
});

describe("executeWhcDbBackup", () => {
  const validRequest = {
    request_id: "r1",
    actor: { kind: "copilot" as const },
    dry_run: false,
    confirmed: true,
    idempotency_key: "idem-1",
    payload: {
      target_environment: "live" as const,
      compress: true,
    },
  };

  it("returns dry_run preview with dump_path", async () => {
    const result = await executeWhcDbBackup(
      baseConfig,
      { ...validRequest, dry_run: true },
      { sshClient: mockSshClient({}) },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.dump_path).toMatch(/\.sql\.gz$/);
    expect(result.data?.compressed).toBe(true);
  });

  it("returns dump_path and size_hint on success", async () => {
    const result = await executeWhcDbBackup(
      baseConfig,
      validRequest,
      { sshClient: mockSshClient({ stdout: "24M\n" }) },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.size_hint).toBe("24M");
    expect(result.meta.safety_level).toBe("D");
  });

  it("returns error when staging SSH not configured", async () => {
    const result = await executeWhcDbBackup(
      { ...baseConfig, sshTargets: { prod: baseConfig.sshTargets.prod } },
      { ...validRequest, payload: { ...validRequest.payload, target_environment: "staging" } },
      { sshClient: mockSshClient({}) },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("returns error when SSH exec fails", async () => {
    const result = await executeWhcDbBackup(
      baseConfig,
      validRequest,
      { sshClient: mockSshClient({ ok: false, stdout: "", stderr: "wp: command not found", message: "exit 127" }) },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TEMPORARY_UPSTREAM_ERROR");
  });
});
