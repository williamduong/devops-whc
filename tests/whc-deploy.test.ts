import { describe, expect, it } from "vitest";
import { executeWhcDeploy, resolveDeploySafetyLevel } from "../src/handlers/whc-deploy";
import { validateWhcDeployRequest } from "../src/schemas/whc-deploy";
import { WhcUapiClient, UapiTriggerDeploymentResult } from "../src/clients/whc-uapi-client";
import { InMemoryDeploymentLockService } from "../src/services/deployment-locks";

const baseConfig = {
  apiToken: "token",
  user: "bbcyvf27",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_controlled" as const,
  domains: { primary: "example.com" },
  paths: { prod: "/home/prod/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: {
    requireStagingConfirm: true,
    warnDynamicDataSync: true,
    enforceStagingFirst: false,
    allowStagingGitControlled: false,
  },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

const sourceProfile = { source_kind: "full_site" as const, deploy_unit: "raw_source" as const };

function mockUapiClient(deploy?: UapiTriggerDeploymentResult): WhcUapiClient {
  return {
    triggerDeployment: async () =>
      deploy ?? { ok: true, latencyMs: 5, deployment_id: "dep-123", message: "triggered" },
  } as unknown as WhcUapiClient;
}

describe("whc_deploy schema", () => {
  it("rejects request missing idempotency_key", () => {
    expect(() =>
      validateWhcDeployRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { workflow_mode: "git_controlled", target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: sourceProfile, repository_root: "/home/test" },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("accepts valid managed_clone_sync request", () => {
    const req = validateWhcDeployRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      confirmed: true,
      idempotency_key: "idem-1",
      payload: { workflow_mode: "managed_clone_sync", target_environment: "staging", release_intent: "refresh", pipeline_id: "P2R", source_profile: sourceProfile, direction: "live_to_staging", sync_scope: "files" },
    });
    expect(req.payload.workflow_mode).toBe("managed_clone_sync");
  });
});

describe("resolveDeploySafetyLevel", () => {
  it("returns C for files-only staging_to_live", () => {
    expect(resolveDeploySafetyLevel("staging_to_live", "files")).toBe("C");
  });

  it("returns D for staging_to_live + database", () => {
    expect(resolveDeploySafetyLevel("staging_to_live", "database")).toBe("D");
  });

  it("returns D for staging_to_live + everything", () => {
    expect(resolveDeploySafetyLevel("staging_to_live", "everything")).toBe("D");
  });

  it("returns C for live_to_staging + everything", () => {
    expect(resolveDeploySafetyLevel("live_to_staging", "everything")).toBe("C");
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
        payload: { workflow_mode: "git_controlled", target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: sourceProfile, repository_root: "/home/test" },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("dry_run_preview");
    expect(result.data?.pipeline_status).toBe("pass_partial");
    expect(result.data?.phase_coverage.deployment_state).toBe("excluded");
  });

  it("triggers UAPI deployment for git_controlled mode", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r1",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-1",
        payload: { workflow_mode: "git_controlled", target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: sourceProfile, repository_root: "/home/bbcyvf27/public_html", branch: "main" },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("deployed");
    expect(result.data?.deployment_id).toBe("dep-123");
    expect(result.data?.pipeline_status).toBe("pass_partial");
    expect(result.data?.phase_coverage.code_state).toBe("included");
    expect(result.data?.phase_coverage.data_state).toBe("excluded");
  });

  it("blocks direct live deploy in git_controlled mode when staging-first policy is enabled", async () => {
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
        request_id: "r-live-git-block",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-live-git-block",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Staging-first policy/);
  });

  it("blocks live target unless flow is managed promote staging_to_live", async () => {
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
        request_id: "r-live-managed-block",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-live-managed-block",
        payload: {
          workflow_mode: "managed_clone_sync",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          direction: "staging_to_live",
          sync_scope: "files",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("allows live target for managed promote flow from staging", async () => {
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
        request_id: "r-live-promote-allow",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-live-promote-allow",
        payload: {
          workflow_mode: "managed_clone_sync",
          target_environment: "live",
          release_intent: "promote",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          direction: "staging_to_live",
          sync_scope: "files",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("synced_staging_to_live");
  });

  it("returns error if git_controlled missing repository_root", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r1",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-1",
        payload: { workflow_mode: "git_controlled", target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: sourceProfile },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("blocks git_controlled staging deploy when server workflow mode is managed_clone_sync", async () => {
    const configManagedMode = {
      ...baseConfig,
      workflowMode: "managed_clone_sync" as const,
    };

    const result = await executeWhcDeploy(
      configManagedMode,
      {
        request_id: "r-mode-lock",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-mode-lock",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Server mode lock/);
    expect(result.error?.message).toMatch(/managed_clone_sync/);
  });

  it("allows git_controlled staging deploy when override is enabled", async () => {
    const configManagedModeOverride = {
      ...baseConfig,
      workflowMode: "managed_clone_sync" as const,
      safety: {
        ...baseConfig.safety,
        allowStagingGitControlled: true,
      },
    };

    const result = await executeWhcDeploy(
      configManagedModeOverride,
      {
        request_id: "r-mode-lock-override",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-mode-lock-override",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("dry_run_preview");
  });

  it("blocks git_controlled staging deploy when path owner mismatches and explains cross-account limitation", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-owner-mismatch",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-owner-mismatch",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/stag290886/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Path owner mismatch/);
    // Must explain the cross-account UAPI limitation for staging, not just suggest wrong live path
    expect(result.error?.message).toMatch(/separate-account staging|managed_clone_sync/);
    // Must NOT suggest target_environment=live as the solution when the intent was staging
    expect(result.error?.message).not.toMatch(/"target_environment":\s*"live"/);
  });

  it("blocks git_controlled staging deploy when repository_root mismatches configured WHC_STAGING_PATH", async () => {
    const configWithStagingPath = {
      ...baseConfig,
      paths: {
        ...baseConfig.paths,
        staging: "/home/stag290886/public_html",
      },
    };

    const result = await executeWhcDeploy(
      configWithStagingPath,
      {
        request_id: "r-staging-path-mismatch",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-staging-path-mismatch",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Invalid staging target for git_controlled deploy/);
    expect(result.error?.message).toMatch(/WHC_STAGING_PATH/);
  });

  it("allows git_controlled staging dry-run when repository_root matches WHC_STAGING_PATH", async () => {
    const configWithStagingPath = {
      ...baseConfig,
      paths: {
        ...baseConfig.paths,
        staging: "/home/bbcyvf27/staging-public",
      },
    };

    const result = await executeWhcDeploy(
      configWithStagingPath,
      {
        request_id: "r-staging-path-ok",
        actor: { kind: "copilot" },
        dry_run: true,
        confirmed: true,
        idempotency_key: "idem-staging-path-ok",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/staging-public",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("dry_run_preview");
  });

  it("blocks git_controlled live deploy when path owner mismatches and suggests corrected live path", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-owner-mismatch-live",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-owner-mismatch-live",
        payload: {
          workflow_mode: "git_controlled",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          repository_root: "/home/wronguser/public_html",
          branch: "master",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    // Must include corrected live path suggestion
    expect(result.error?.message).toMatch(/\/home\/bbcyvf27\/public_html/);
  });

  it("returns synced_live_to_staging for managed_clone_sync refresh", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r1",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-1",
        payload: { workflow_mode: "managed_clone_sync", target_environment: "staging", release_intent: "refresh", pipeline_id: "P2R", source_profile: sourceProfile, direction: "live_to_staging", sync_scope: "files" },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.outcome).toBe("synced_live_to_staging");
    expect(result.data?.pipeline_status).toBe("pass_partial");
    expect(result.data?.phase_coverage.code_state).toBe("included");
    expect(result.data?.phase_coverage.runtime_state).toBe("excluded");
  });

  it("blocks managed live_to_staging when release_intent is deploy", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-mindset-block",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-mindset-block",
        payload: {
          workflow_mode: "managed_clone_sync",
          target_environment: "staging",
          release_intent: "deploy",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          direction: "live_to_staging",
          sync_scope: "files",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Invalid deploy mindset/);
  });

  it("includes data loss warning for database sync scope", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r1",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-1",
        payload: { workflow_mode: "managed_clone_sync", target_environment: "live", release_intent: "promote", pipeline_id: "P3D", source_profile: sourceProfile, direction: "staging_to_live", sync_scope: "database", backup_reference: "backup-1" },
      },
      { uapiClient: mockUapiClient() },
    );
    expect(result.ok).toBe(true);
    expect(result.data?.warnings.some((w) => w.includes("DATABASE"))).toBe(true);
    expect(result.meta.safety_level).toBe("D");
  });

  it("blocks high-risk staging_to_live sync without backup reference", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-gate",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-gate",
        payload: {
          workflow_mode: "managed_clone_sync",
          target_environment: "live",
          release_intent: "promote",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          direction: "staging_to_live",
          sync_scope: "everything",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("allows high-risk sync with backup reference", async () => {
    const result = await executeWhcDeploy(
      baseConfig,
      {
        request_id: "r-gate-ok",
        actor: { kind: "copilot" },
        confirmed: true,
        idempotency_key: "idem-gate-ok",
        payload: {
          workflow_mode: "managed_clone_sync",
          target_environment: "live",
          release_intent: "promote",
          pipeline_id: "P3D",
          source_profile: sourceProfile,
          direction: "staging_to_live",
          sync_scope: "database",
          backup_reference: "backup-2026-06-08-001",
        },
      },
      { uapiClient: mockUapiClient() },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.backup_reference).toBe("backup-2026-06-08-001");
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
          workflow_mode: "git_controlled",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
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
          workflow_mode: "git_controlled",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
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
          workflow_mode: "git_controlled",
          target_environment: "live",
          release_intent: "deploy",
          pipeline_id: "P3",
          source_profile: sourceProfile,
          repository_root: "/home/bbcyvf27/public_html",
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
});
