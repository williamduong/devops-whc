import { describe, expect, it } from "vitest";
import { validateWhcGetLogsRequest } from "../src/schemas/whc-get-logs";
import { executeWhcGetLogs } from "../src/handlers/whc-get-logs";
import { WhcSshClient, SshExecResult } from "../src/clients/ssh-client";

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

function mockSshClient(result: Partial<SshExecResult>): WhcSshClient {
  return {
    execWithKey: async () => ({
      ok: true,
      latencyMs: 10,
      stdout: "",
      stderr: "",
      message: "ok",
      ...result,
    }),
  } as unknown as WhcSshClient;
}

describe("whc_get_logs schema", () => {
  it("rejects request missing target_environment", () => {
    expect(() =>
      validateWhcGetLogsRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: {},
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("accepts valid request with defaults", () => {
    const req = validateWhcGetLogsRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      payload: { target_environment: "live" },
    });
    expect(req.payload.log_type).toBe("apache_error");
    expect(req.payload.lines).toBe(50);
  });
});

describe("executeWhcGetLogs", () => {
  it("returns log entries from SSH stdout", async () => {
    const result = await executeWhcGetLogs(
      baseConfig,
      validateWhcGetLogsRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live", log_type: "apache_error", lines: 5 },
      }),
      { sshClient: mockSshClient({ stdout: "[error] line 1\n[error] line 2\n" }) },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.entries).toHaveLength(2);
    expect(result.data?.log_type).toBe("apache_error");
  });

  it("returns empty entries when log not found", async () => {
    const result = await executeWhcGetLogs(
      baseConfig,
      validateWhcGetLogsRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live" },
      }),
      { sshClient: mockSshClient({ stdout: "__LOG_NOT_FOUND__" }) },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.entries).toHaveLength(0);
  });

  it("returns error when staging not configured", async () => {
    const result = await executeWhcGetLogs(
      { ...baseConfig, sshTargets: { prod: baseConfig.sshTargets.prod } },
      validateWhcGetLogsRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "staging" },
      }),
      { sshClient: mockSshClient({}) },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });
});
