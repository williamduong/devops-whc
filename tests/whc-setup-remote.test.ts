import { describe, expect, it } from "vitest";
import { executeWhcSetupRemote } from "../src/handlers/whc-setup-remote";
import { validateWhcSetupRemoteRequest } from "../src/schemas/whc-setup-remote";
import { WhcUapiClient, UapiListRepositoriesResult, UapiCreateRepositoryResult } from "../src/clients/whc-uapi-client";

const baseConfig = {
  apiToken: "token",
  user: "bbcyvf27",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_deploy" as const,
  domains: { primary: "example.com", testing: undefined, staging: undefined },
  paths: { prod: "/home/prod/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
    localProjectRoot: "D:/Source/myproject",
    localAppPath: undefined,
    buildCommand: undefined,
    buildArtifactPath: undefined,
  },
  safety: { requireStagingConfirm: true, warnDynamicDataSync: true },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

const validRequest = {
  request_id: "req-setup-1",
  actor: { kind: "copilot" as const },
  confirmed: true,
  idempotency_key: "idem-setup-1",
  payload: {
    target_environment: "live" as const,
    release_intent: "deploy" as const,
    pipeline_id: "P3" as const,
    source_profile: { source_kind: "full_site" as const, deploy_unit: "raw_source" as const },
    deploy_target_path: "/home/bbcyvf27/public_html",
  },
};

function mockUapiClient(overrides: {
  list?: UapiListRepositoriesResult;
  create?: UapiCreateRepositoryResult;
}): WhcUapiClient {
  return {
    probe: async () => ({ ok: true, latencyMs: 5, message: "ok" }),
    listRepositories: async () =>
      overrides.list ?? { ok: true, latencyMs: 5, repositories: [], message: "ok" },
    createRepository: async () =>
      overrides.create ?? { ok: true, latencyMs: 5, repository_root: "/home/bbcyvf27/public_html", message: "created" },
  } as unknown as WhcUapiClient;
}

describe("whc_setup_remote schema", () => {
  it("rejects request missing idempotency_key", () => {
    expect(() =>
      validateWhcSetupRemoteRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: { source_kind: "full_site", deploy_unit: "raw_source" }, deploy_target_path: "/home/test" },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("rejects payload missing deploy_target_path", () => {
    expect(() =>
      validateWhcSetupRemoteRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        idempotency_key: "key",
        payload: { target_environment: "live", release_intent: "deploy", pipeline_id: "P3", source_profile: { source_kind: "full_site", deploy_unit: "raw_source" } },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });
});

describe("whc_setup_remote handler", () => {
  it("creates repo and returns ssh_remote_hint with meta fields", async () => {
    const request = validateWhcSetupRemoteRequest(validRequest);
    const result = await executeWhcSetupRemote(baseConfig, request, {
      uapiClient: mockUapiClient({}),
      actionIdFactory: () => "action-setup-1",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.was_existing).toBe(false);
    expect(result.data?.ssh_remote_hint).toBe("bbcyvf27@srv44.swhc.ca:/home/bbcyvf27/public_html");
    expect(result.data?.repository_root).toBe("/home/bbcyvf27/public_html");
    expect(result.data?.pipeline_status).toBe("pass_partial");
    expect(result.data?.phase_coverage.deployment_state).toBe("included");
    expect(result.data?.process_tracking.status).toBe("needs_manual_input");
    expect(result.data?.process_tracking.next_step).toMatch(/git/i);
    expect(result.meta.pipeline_id).toBe("P3");
    expect(result.meta.release_intent).toBe("deploy");
    expect(result.meta.delivery_mechanism).toBe("git_deploy");
    expect(result.meta.source_profile?.source_kind).toBe("full_site");
  });

  it("returns was_existing when repo already registered", async () => {
    const request = validateWhcSetupRemoteRequest(validRequest);
    const result = await executeWhcSetupRemote(baseConfig, request, {
      uapiClient: mockUapiClient({
        list: {
          ok: true,
          latencyMs: 5,
          repositories: [{ repository_root: "/home/bbcyvf27/public_html", type: "git" }],
          message: "ok",
        },
      }),
      actionIdFactory: () => "action-setup-2",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.was_existing).toBe(true);
    expect(result.data?.migration_guidance).toMatch(/already exists/i);
  });

  it("returns dry_run preview without calling createRepository", async () => {
    const dryRequest = validateWhcSetupRemoteRequest({ ...validRequest, dry_run: true });
    let createCalled = false;
    const result = await executeWhcSetupRemote(baseConfig, dryRequest, {
      uapiClient: {
        ...mockUapiClient({}),
        createRepository: async () => {
          createCalled = true;
          return { ok: true, latencyMs: 5, message: "should not be called" };
        },
      } as unknown as WhcUapiClient,
      actionIdFactory: () => "action-dryrun",
    });

    expect(result.ok).toBe(true);
    expect(result.data?.migration_guidance).toMatch(/dry_run/);
    expect(result.data?.phase_coverage.deployment_state).toBe("excluded");
    expect(result.data?.process_tracking.status).toBe("needs_manual_input");
    expect(createCalled).toBe(false);
  });

  it("returns error when UAPI list_repositories fails", async () => {
    const request = validateWhcSetupRemoteRequest(validRequest);
    const result = await executeWhcSetupRemote(baseConfig, request, {
      uapiClient: mockUapiClient({
        list: { ok: false, latencyMs: 5, repositories: [], message: "Unauthorized" },
      }),
      actionIdFactory: () => "action-err",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TEMPORARY_UPSTREAM_ERROR");
  });

  it("returns error when UAPI create fails", async () => {
    const request = validateWhcSetupRemoteRequest(validRequest);
    const result = await executeWhcSetupRemote(baseConfig, request, {
      uapiClient: mockUapiClient({
        create: { ok: false, latencyMs: 5, message: "Path already in use" },
      }),
      actionIdFactory: () => "action-create-err",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TEMPORARY_UPSTREAM_ERROR");
  });

  it("includes full-site warning for deploy intent", async () => {
    const request = validateWhcSetupRemoteRequest(validRequest);
    const result = await executeWhcSetupRemote(baseConfig, request, {
      uapiClient: mockUapiClient({}),
      actionIdFactory: () => "action-warn",
    });

    expect(result.ok).toBe(true);
    const hasWebRootWarning = result.data?.warnings.some((w) => /webroot/i.test(w));
    expect(hasWebRootWarning).toBe(true);
  });

  it("blocks when deploy_target_path owner mismatches WHC_USER", async () => {
    const mismatchRequest = validateWhcSetupRemoteRequest({
      ...validRequest,
      payload: {
        ...validRequest.payload,
        deploy_target_path: "/home/stag290886/public_html",
      },
    });

    const result = await executeWhcSetupRemote(baseConfig, mismatchRequest, {
      uapiClient: mockUapiClient({}),
      actionIdFactory: () => "action-owner-mismatch",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
    expect(result.error?.message).toMatch(/Path owner mismatch/);
  });
});
