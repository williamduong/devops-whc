import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWhcVerifyRequest } from "../src/schemas/whc-verify";
import { executeWhcVerify } from "../src/handlers/whc-verify";
import { WhcSshClient } from "../src/clients/ssh-client";

const baseConfig = {
  apiToken: "token",
  user: "user",
  host: "host.example.com",
  apiBaseUrl: "https://host.example.com:2083",
  workflowMode: "managed_clone_sync" as const,
  domains: {},
  paths: { prod: "/home/prod/public_html", staging: "/home/staging/public_html" },
  sourceProfile: {
    sourceKind: "full_site" as const,
    deployUnit: "raw_source" as const,
    defaultReleaseIntent: "deploy" as const,
  },
  safety: { requireStagingConfirm: true, warnDynamicDataSync: true },
  sshTargets: {
    prod: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
    staging: { host: "srv44.swhc.ca", port: 27, username: "bbcyvf27", privateKeyPath: "C:/fake/key" },
  },
  apiTimeoutMs: 15000,
  sshTimeoutMs: 10000,
};

function mockSshClient(stdout: string): WhcSshClient {
  return {
    execWithKey: async () => ({ ok: true, latencyMs: 5, stdout, stderr: "", message: "ok" }),
  } as unknown as WhcSshClient;
}

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("whc_verify schema", () => {
  it("rejects invalid verify_level", () => {
    expect(() =>
      validateWhcVerifyRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live", verify_level: "invalid" },
      }),
    ).toThrow(/VALIDATION_ERROR/);
  });

  it("accepts valid request with defaults", () => {
    const req = validateWhcVerifyRequest({
      request_id: "r1",
      actor: { kind: "copilot" },
      payload: { target_environment: "live" },
    });
    expect(req.payload.verify_level).toBe("default");
  });
});

describe("executeWhcVerify", () => {
  it("returns NOT_FOUND when no manifest exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-verify-missing-"));
    process.chdir(root);

    const result = await executeWhcVerify(
      baseConfig,
      validateWhcVerifyRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live" },
      }),
      {
        sshClient: mockSshClient(""),
        probeRunner: async () => ({
          uapi: { ok: true, latencyMs: 1, message: "ok" },
          ssh: { ok: true, latencyMs: 1, message: "ok" },
          sshEnvironments: {
            prod: { ok: true, latencyMs: 1, message: "ok" },
            staging: { ok: true, latencyMs: 1, message: "ok" },
          },
          wpcli: {
            prod: { reachable: true, available: true, latencyMs: 1, message: "ok" },
            staging: { reachable: true, available: true, latencyMs: 1, message: "ok" },
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("verifies manifest and writes report", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-verify-success-"));
    process.chdir(root);

    const releases = join(root, ".whc", "state", "releases");
    mkdirSync(releases, { recursive: true });
    const manifest = join(releases, "req-100.auto-manifest.json");
    writeFileSync(
      manifest,
      JSON.stringify(
        {
          request_id: "req-100",
          release_intent: "deploy",
          changed_files: ["wp-content/themes/mytho/style.css", "index.php"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await executeWhcVerify(
      baseConfig,
      validateWhcVerifyRequest({
        request_id: "r1",
        actor: { kind: "copilot" },
        payload: { target_environment: "live", release_id: "req-100" },
      }),
      {
        sshClient: mockSshClient("OK:wp-content/themes/mytho/style.css\nOK:index.php\n"),
        probeRunner: async () => ({
          uapi: { ok: true, latencyMs: 1, message: "ok" },
          ssh: { ok: true, latencyMs: 1, message: "ok" },
          sshEnvironments: {
            prod: { ok: true, latencyMs: 1, message: "ok" },
            staging: { ok: true, latencyMs: 1, message: "ok" },
          },
          wpcli: {
            prod: { reachable: true, available: true, latencyMs: 1, message: "ok" },
            staging: { reachable: true, available: true, latencyMs: 1, message: "ok" },
          },
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data?.file_verification.missing_files).toHaveLength(0);
    expect(result.data?.final_status).toBe("PASS");
    expect(result.data?.report_file).toContain("verify-report.json");
  });
});
