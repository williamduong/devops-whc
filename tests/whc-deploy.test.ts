import { describe, expect, it } from "vitest";
import { executeWhcDeploy, resolveDeploySafetyLevel } from "../src/handlers/whc-deploy";
import { validateWhcDeployRequest } from "../src/schemas/whc-deploy";
import { WhcUapiClient } from "../src/clients/whc-uapi-client";
import { InMemoryDeploymentLockService } from "../src/services/deployment-locks";

const baseConfig = {
  apiToken: "token",
  user: "bbcyvf27",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_deploy" as const,
  domains: { primary: "example.com" },
  paths: { prod: "/home/bbcyvf27/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: {
    requireStagingConfirm: true,
    warnDynamicDataSync: true,
    enforceStagingFirst: false,
  },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

const sourceProfile = { source_kind: "full_site" as const, deploy_unit: "raw_source" as const };
const repositoryRoot = "/home/bbcyvf27/repositories/mytho";

function mockUapiClient(ok = true): WhcUapiClient {
  return {
    triggerDeployment: async (repository_root: string, branch?: string) => ({
      ok,
      latencyMs: 5,
      deployment_id: ok ? "dep-123" : undefined,
      message: ok ? `Triggered ${repository_root}${branch ? `#${branch}` : ""}` : "failed",
    }),
  } as unknown as WhcUapiClient;
}

describe("whc_deploy schema", () => {
  it("rejects request missing idempotency_key", () => {
    expect(() =>
      validateWhcDeployRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
        },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("requires repository_root for git_deploy", () => {
    expect(() =>
      validateWhcDeployRequest({
        request_id: "r-missing-root",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-missing-root",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
        },
      }),
    ).toThrow(/repository_root/);
  });

  it("accepts valid git_deploy request", () => {
    const req = validateWhcDeployRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      confirmed: true,
      idempotency_key: "idem-1",
      payload: {
        workflow_mode: "git_deploy",
        target_environment: "staging",
        release_intent: "deploy",
        pipeline_id: "P3D",
        source_profile: sourceProfile,
        repository_root: repositoryRoot,
        branch: "main",
      },
    });
    expect(req.payload.workflow_mode).toBe("git_deploy");
    expect(req.payload.repository_root).toBe(repositoryRoot);
  });

  it("accepts ssh_scp_wpcli request shape", () => {
    const req = validateWhcDeployRequest({
      request_id: "r-ssh-scp",
      actor: { kind: "copilot" },
      dry_run: true,
      confirmed: true,
      idempotency_key: "idem-ssh-scp",
      payload: {
        workflow_mode: "ssh_scp_wpcli",
        target_environment: "staging",
        release_intent: "deploy",
        pipeline_id: "P3D",
        source_profile: sourceProfile,
      },
    });
    expect(req.payload.workflow_mode).toBe("ssh_scp_wpcli");
  });
});

describe("resolveDeploySafetyLevel", () => {
  it("returns level C for git deployment flow", () => {
    expect(resolveDeploySafetyLevel()).toBe("C");
  });
});

describe("executeWhcDeploy", () => {
  it("returns dry_run_preview on dry run", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r1",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-1",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          branch: "main",
        },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("dry_run_preview");
    expect(result.data?.repository_root).toBe(repositoryRoot);
    expect(result.data?.phase_coverage.deployment_state).toBe("excluded");
  });

  it("blocks live git deploy unless release_intent is promote when staging-first is enabled", async () => {
    const configEnforced = {
      ...baseConfig,
      safety: {
        ...baseConfig.safety,
        enforceStagingFirst: true,
      },
    };

    const result = await executeWhcDeploy(
      configEnforced,
      {
        request_id: "r-live-block",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-live-block",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          branch: "main",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("triggers deployment for allowed live promote flow", async () => {
    const configEnforced = {
      ...baseConfig,
      safety: {
        ...baseConfig.safety,
        enforceStagingFirst: true,
      },
    };

    const result = await executeWhcDeploy(
      configEnforced,
      {
        request_id: "r-live-promote",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-live-promote",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "live",
          release_intent: "promote",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          branch: "release/live",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("deployment_triggered");
    expect(result.data?.deployment_id).toBe("dep-123");
  });

  it("calls real triggerDeployment instead of returning synthetic success", async () => {
    let calledWith: { repository_root?: string; branch?: string } = {};
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-trigger",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-trigger",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          branch: "main",
        },
      },
      {
        uapiClient: {
          triggerDeployment: async (root: string, branch?: string) => {
            calledWith = { repository_root: root, branch };
            return {
              ok: true,
              latencyMs: 5,
              deployment_id: "dep-real",
              message: "ok",
            };
          },
        } as unknown as WhcUapiClient,
      },
    );

    expect(result.ok).toBe(true);
    expect(calledWith).toEqual({ repository_root: repositoryRoot, branch: "main" });
    expect(result.data?.deployment_id).toBe("dep-real");
  });

  it("returns upstream error when git deployment trigger fails", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-trigger-fail",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-trigger-fail",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
        },
      },
      { uapiClient: mockUapiClient(false) },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TEMPORARY_UPSTREAM_ERROR");
    expect(result.error?.message).toMatch(/Git deployment trigger failed/);
  });

  it("warns that legacy direction/sync_scope fields are ignored in git_deploy", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-legacy-fields",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-legacy-fields",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          direction: "live_to_staging",
          sync_scope: "files",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.warnings.some((warning) => warning.includes("legacy managed-sync fields"))).toBe(true);
  });

  it("blocks concurrent deployment when lock key already held", async () => {
    const lockService = new InMemoryDeploymentLockService();
    const held = lockService.acquire("deploy-lock-key", "existing-owner");
    expect(held.ok).toBe(true);

    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-lock",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-lock",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          lock_key: "deploy-lock-key",
        },
      },
      { uapiClient: mockUapiClient(), lockService },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Concurrent deployment blocked/);
  });

  it("fails deployment when post-verify fails", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-verify-fail",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-verify-fail",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          verify_after_deploy: true,
        },
      },
      {
        uapiClient: mockUapiClient(),
        verifyRunner: async () => ({ ok: false, message: "health endpoint failed" }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TEMPORARY_UPSTREAM_ERROR");
    expect(result.error?.message).toMatch(/Post-deploy verification failed/);
  });

  it("attempts rollback when verify fails and auto_rollback_on_verify_failure=true", async () => {
    let rollbackCalled = false;
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-verify-rollback",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-verify-rollback",
        payload: {
          workflow_mode: "git_deploy",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: repositoryRoot,
          verify_after_deploy: true,
          auto_rollback_on_verify_failure: true,
        },
      },
      {
        uapiClient: mockUapiClient(),
        verifyRunner: async () => ({ ok: false, message: "runtime check failed" }),
        rollbackRunner: async () => {
          rollbackCalled = true;
          return { ok: true, message: "rollback complete" };
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(rollbackCalled).toBe(true);
  });

  it("returns dry-run preview for ssh_scp_wpcli with a source-script warning", async () => {
    const result = await executeWhcDeploy(
      {
        ...baseConfig,
        workflowMode: "ssh_scp_wpcli",
      },
      {
        request_id: "r-ssh-preview",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-ssh-preview",
        payload: {
          workflow_mode: "ssh_scp_wpcli",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("dry_run_preview");
    expect(result.data?.warnings.some((warning) => warning.includes("project-local pipeline script"))).toBe(true);
  });

  it("blocks real ssh_scp_wpcli deploy until the execution path is implemented", async () => {
    const result = await executeWhcDeploy(
      {
        ...baseConfig,
        workflowMode: "ssh_scp_wpcli",
      },
      {
        request_id: "r-ssh-blocked",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-ssh-blocked",
        payload: {
          workflow_mode: "ssh_scp_wpcli",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/execution is not implemented/);
  });
});
