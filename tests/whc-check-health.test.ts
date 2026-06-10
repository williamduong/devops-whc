import { describe, expect, it } from "vitest";
import { handleWhcCheckHealth } from "../src/handlers/whc-check-health";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "managed_clone_sync" as const,
  domains: {
    primary: "example.com",
    testing: "test.example.com",
    staging: "staging.example.com",
  },
  paths: {
    prod: "/home/prod/public_html",
    staging: "/home/staging/public_html",
  },
  sourceProfile: {
    localProjectRoot: "D:/Source/example",
    localAppPath: "",
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    buildCommand: undefined,
    buildArtifactPath: undefined,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: {
    requireStagingConfirm: true,
    warnDynamicDataSync: true,
  },
  sshTargets: {
    prod: {
      host: "prod-host",
      port: 27,
      username: "produser",
      privateKeyPath: "C:/fake/key",
    },
    staging: {
      host: "staging-host",
      port: 27,
      username: "stageuser",
      privateKeyPath: "C:/fake/staging-key",
    },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

describe("whc_check_health handler", () => {
  it("returns contract metadata with release_intent, source_profile, and pipeline_id", async () => {
    const response = await handleWhcCheckHealth(
      baseConfig,
      {
        request_id: "req-1",
        actor: { kind: "copilot" },
        payload: {
          target_environment: "auto",
          release_intent: "deploy",
          pipeline_id: "P1",
          source_profile: {
            source_kind: "full_site",
            deploy_unit: "raw_source",
          },
        },
      },
      {
        actionIdFactory: () => "action-1",
        probeRunner: async () => ({
          uapi: { ok: true, latencyMs: 10, message: "ok" },
          ssh: { ok: true, latencyMs: 10, message: "ok" },
          sshEnvironments: {
            prod: { ok: true, latencyMs: 10, message: "ok" },
            staging: { ok: true, latencyMs: 10, message: "ok" },
          },
          wpcli: {
            prod: { reachable: true, available: true, latencyMs: 10, message: "ok" },
            staging: { reachable: true, available: true, latencyMs: 10, message: "ok" },
          },
        }),
      },
    );

    expect(response.ok).toBe(true);
    expect(response.meta.pipeline_id).toBe("P1");
    expect(response.meta.release_intent).toBe("deploy");
    expect(response.meta.source_profile?.source_kind).toBe("full_site");
  });

  it("returns validation error when payload contract is invalid", async () => {
    const response = await handleWhcCheckHealth(
      baseConfig,
      {
        request_id: "req-2",
        actor: { kind: "copilot" },
        payload: {
          target_environment: "auto",
        },
      },
      {
        actionIdFactory: () => "action-2",
      },
    );

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("VALIDATION_ERROR");
  });
});
