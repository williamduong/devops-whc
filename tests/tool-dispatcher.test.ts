import { describe, expect, it, vi } from "vitest";
import { dispatch } from "../src/dispatcher/tool-dispatcher";
import { TOOL_REGISTRY } from "../src/registry/tool-registry";
import { InMemoryIdempotencyStore } from "../src/idempotency/store";
import { ConsoleAuditLogger } from "../src/audit/audit-logger";
import { ToolResponseEnvelope } from "../src/contracts/envelope";
import { executeWhcCheckHealth } from "../src/handlers/whc-check-health";
import { validateWhcCheckHealthRequest } from "../src/schemas/whc-check-health";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "git_deploy" as const,
  domains: { primary: "example.com", testing: undefined, staging: undefined },
  paths: { prod: "/home/prod/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
    localProjectRoot: undefined,
    localAppPath: undefined,
    buildCommand: undefined,
    buildArtifactPath: undefined,
  },
  safety: { requireStagingConfirm: true, warnDynamicDataSync: true },
  sshTargets: {
    prod: { host: "prod-host", port: 27, username: "produser", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

const validCheckHealthInput = {
  request_id: "req-1",
  actor: { kind: "copilot" as const },
  payload: {
    target_environment: "auto" as const,
    release_intent: "deploy" as const,
    pipeline_id: "P1" as const,
    source_profile: { source_kind: "full_site" as const, deploy_unit: "raw_source" as const },
  },
};

const mockProbe = async () => ({
  uapi: { ok: true, latencyMs: 5, message: "ok" },
  ssh: { ok: true, latencyMs: 5, message: "ok" },
  sshEnvironments: {
    prod: { ok: true, latencyMs: 5, message: "ok" },
    staging: { ok: true, latencyMs: 5, message: "ok" },
  },
  wpcli: {
    prod: { reachable: true, available: true, latencyMs: 5, message: "ok" },
    staging: { reachable: true, available: true, latencyMs: 5, message: "ok" },
  },
});

describe("tool dispatcher", () => {
  it("returns validation error when input fails schema", async () => {
    const toolDef = TOOL_REGISTRY["whc_check_health"];
    const result = await dispatch({
      config: baseConfig,
      toolDef,
      rawInput: { request_id: "r1", actor: { kind: "copilot" }, payload: {} },
      validate: (input) => {
        const parsed = input as Record<string, unknown>;
        const payload = parsed["payload"] as Record<string, unknown>;
        if (!payload["release_intent"]) throw new Error("VALIDATION_ERROR: release_intent required");
        return input as never;
      },
      execute: async () => ({ ok: true, action_id: "x", tool: "t", data: null, error: null, meta: { safety_level: "A" as const } }),
      idempotencyStore: new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>(),
      auditLogger: new ConsoleAuditLogger(),
      actionIdFactory: () => "action-test",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("blocks level C write when confirmed is missing", async () => {
    const toolDef = TOOL_REGISTRY["whc_setup_remote"]; // safetyLevel C
    const result = await dispatch({
      config: baseConfig,
      toolDef,
      rawInput: {},
      validate: (input) => ({
        request_id: "r1",
        actor: { kind: "copilot" as const },
        confirmed: false,
        idempotency_key: "key-1",
        payload: input as never,
      }),
      execute: async () => ({ ok: true, action_id: "x", tool: "t", data: null, error: null, meta: { safety_level: "C" as const } }),
      idempotencyStore: new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>(),
      auditLogger: new ConsoleAuditLogger(),
      actionIdFactory: () => "action-test",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BUSINESS_POLICY_BLOCKED");
  });

  it("returns cached response on idempotent replay for write", async () => {
    const toolDef = TOOL_REGISTRY["whc_setup_remote"];
    const store = new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>();
    const executeFn = vi.fn().mockResolvedValue({
      ok: true,
      action_id: "original-action",
      tool: "whc_setup_remote",
      data: { repository_root: "/home/test" },
      error: null,
      meta: { safety_level: "C" as const },
    });

    const dispatchOptions = {
      config: baseConfig,
      toolDef,
      rawInput: {},
      validate: () => ({
        request_id: "r1",
        actor: { kind: "copilot" as const },
        confirmed: true,
        idempotency_key: "idem-abc",
        payload: { target_environment: "live" as const, release_intent: "deploy" as const, pipeline_id: "P3" as const, source_profile: { source_kind: "full_site" as const, deploy_unit: "raw_source" as const }, deploy_target_path: "/home/test" },
      }),
      execute: executeFn,
      idempotencyStore: store as InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>,
      auditLogger: new ConsoleAuditLogger(),
      actionIdFactory: () => "action-test",
    };

    const first = await dispatch(dispatchOptions);
    const second = await dispatch(dispatchOptions);

    expect(first.action_id).toBe("original-action");
    expect(second.action_id).toBe("original-action");
    expect(executeFn).toHaveBeenCalledTimes(1); // second call hits cache
  });

  it("calls audit logger for write tools", async () => {
    const toolDef = TOOL_REGISTRY["whc_setup_remote"];
    const auditLogger = new ConsoleAuditLogger();
    const logSpy = vi.spyOn(auditLogger, "log");

    await dispatch({
      config: baseConfig,
      toolDef,
      rawInput: {},
      validate: () => ({
        request_id: "r1",
        actor: { kind: "copilot" as const },
        confirmed: true,
        idempotency_key: "key-audit",
        payload: { target_environment: "live" as const, release_intent: "deploy" as const, pipeline_id: "P3" as const, source_profile: { source_kind: "full_site" as const, deploy_unit: "raw_source" as const }, deploy_target_path: "/home/test" },
      }),
      execute: async () => ({ ok: true, action_id: "audit-action", tool: "whc_setup_remote", data: null, error: null, meta: { safety_level: "C" as const } }),
      idempotencyStore: new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>(),
      auditLogger,
      actionIdFactory: () => "audit-action",
    });

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0].tool).toBe("whc_setup_remote");
  });

  it("does not audit read-only tools", async () => {
    const toolDef = TOOL_REGISTRY["whc_check_health"];
    const auditLogger = new ConsoleAuditLogger();
    const logSpy = vi.spyOn(auditLogger, "log");

    await dispatch({
      config: baseConfig,
      toolDef,
      rawInput: validCheckHealthInput,
      validate: validateWhcCheckHealthRequest,
      execute: (cfg, req) => executeWhcCheckHealth(cfg, req, { probeRunner: mockProbe }),
      idempotencyStore: new InMemoryIdempotencyStore<ToolResponseEnvelope<unknown>>(),
      auditLogger,
      actionIdFactory: () => "read-action",
    });

    expect(logSpy).not.toHaveBeenCalled();
  });
});
