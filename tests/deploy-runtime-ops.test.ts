import { describe, expect, it } from "vitest";
import { runDeployRollback, runDeployVerification } from "../src/services/deploy-runtime-ops";
import { WhcSshClient } from "../src/clients/ssh-client";
import { WhcUapiClient } from "../src/clients/whc-uapi-client";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_deploy" as const,
  domains: { primary: "example.com" },
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

const baseRequest = {
  request_id: "req-1",
  actor: { kind: "copilot" as const },
  confirmed: true,
  idempotency_key: "idem-1",
  payload: {
    workflow_mode: "git_deploy" as const,
    target_environment: "live" as const,
    release_intent: "deploy" as const,
    pipeline_id: "P3" as const,
    source_profile: { source_kind: "full_site" as const, deploy_unit: "raw_source" as const },
    repository_root: "/home/prod/public_html",
    branch: "main",
  },
};

function mockSsh(stdout: string, ok = true): WhcSshClient {
  return {
    execWithKey: async () => ({
      ok,
      latencyMs: 10,
      stdout,
      stderr: "",
      message: ok ? "ok" : "ssh failed",
    }),
  } as unknown as WhcSshClient;
}

function mockUapi(ok = true): WhcUapiClient {
  return {
    triggerDeployment: async () => ({
      ok,
      latencyMs: 10,
      deployment_id: ok ? "dep-rollback" : undefined,
      message: ok ? "rollback ok" : "rollback failed",
    }),
  } as unknown as WhcUapiClient;
}

describe("runDeployVerification", () => {
  it("always passes for git_deploy", async () => {
    const result = await runDeployVerification(baseConfig, baseRequest, mockSsh(""));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/git_deploy/i);
  });
});

describe("runDeployRollback", () => {
  it("always returns not-supported message", async () => {
    const result = await runDeployRollback(baseConfig, baseRequest, mockUapi(true));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not supported/i);
  });
});
