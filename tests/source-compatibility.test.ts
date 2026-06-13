import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runSourceCompatibilityCheck } from "../src/probes/source-compatibility";

function createMythoLikeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "whc-source-check-"));
  mkdirSync(join(root, "wordpress", "wp-content", "plugins", "mytho-core"), { recursive: true });
  mkdirSync(join(root, "wordpress", "wp-content", "themes", "mytho-child"), { recursive: true });
  mkdirSync(join(root, "wordpress", "wp-content", "uploads"), { recursive: true });
  mkdirSync(join(root, "wordpress", "scripts"), { recursive: true });
  writeFileSync(join(root, "wordpress", "wp-config.php"), "<?php\n");
  writeFileSync(join(root, "wordpress", "wp-content", "plugins", "mytho-core", "mytho-core.php"), "<?php\n/*\nPlugin Name: Mytho Core\n*/\n");
  writeFileSync(join(root, "wordpress", "wp-content", "themes", "mytho-child", "style.css"), "/*\nTheme Name: Mytho Child\n*/\n");
  writeFileSync(join(root, "wordpress", "scripts", "seed-local-sample-data.php"), "<?php\n// idempotent\n");
  return root;
}

describe("runSourceCompatibilityCheck", () => {
  it("passes ssh_scp_wpcli mode for a mytho-like workspace when local and remote probes are healthy", async () => {
    const root = createMythoLikeWorkspace();
    const report = await runSourceCompatibilityCheck(
      {
        apiToken: "",
        user: "",
        host: "",
        apiBaseUrl: "",
        workflowMode: "ssh_scp_wpcli",
        domains: { staging: "staging.example.com" },
        paths: { prod: "/public_html", staging: "/home/staging/public_html" },
        sourceProfile: {
          localProjectRoot: root,
          localAppPath: "wordpress",
          sourceKind: "full_site",
          deployUnit: "raw_source",
          defaultReleaseIntent: "deploy",
        },
        safety: {
          requireStagingConfirm: true,
          warnDynamicDataSync: true,
          enforceStagingFirst: true,
        },
        sshTargets: {
          prod: { host: "unused", port: 27, username: "unused", privateKeyPath: "C:/fake/key" },
          staging: { host: "staging.example.com", port: 27, username: "stag", privateKeyPath: "C:/fake/key" },
        },
        apiTimeoutMs: 15000,
        sshTimeoutMs: 10000,
      },
      {
        hasCommand: () => true,
        runSshScpWpCliProbe: async () => ({
          stagingSsh: { ok: true, message: "SSH_OK" },
          remotePath: { ok: true, message: "REMOTE_OK" },
          wpInstalled: { ok: true, message: "WP_OK" },
          wpCli: { reachable: true, available: true, message: "staging WP-CLI available" },
          httpProbe: { ok: true, message: "https://staging.example.com/wp-json/ returned 200" },
        }),
      },
    );

    expect(report.ok).toBe(true);
    expect(report.ready_for_deploy).toBe(true);
    expect(report.summary.fail).toBe(0);
    expect(report.warnings).toHaveLength(0);
  });

  it("fails ssh_scp_wpcli mode when deployable plugin is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "whc-source-check-missing-"));
    mkdirSync(join(root, "wordpress", "wp-content", "themes", "mytho-child"), { recursive: true });
    mkdirSync(join(root, "wordpress", "scripts"), { recursive: true });
    writeFileSync(join(root, "wordpress", "wp-content", "themes", "mytho-child", "style.css"), "/*\nTheme Name: Mytho Child\n*/\n");
    writeFileSync(join(root, "wordpress", "scripts", "seed-local-sample-data.php"), "<?php\n// idempotent\n");

    const report = await runSourceCompatibilityCheck(
      {
        apiToken: "",
        user: "",
        host: "",
        apiBaseUrl: "",
        workflowMode: "ssh_scp_wpcli",
        domains: { staging: "staging.example.com" },
        paths: { prod: "/public_html", staging: "/home/staging/public_html" },
        sourceProfile: {
          localProjectRoot: root,
          localAppPath: "wordpress",
          sourceKind: "full_site",
          deployUnit: "raw_source",
          defaultReleaseIntent: "deploy",
        },
        safety: {
          requireStagingConfirm: true,
          warnDynamicDataSync: true,
          enforceStagingFirst: true,
        },
        sshTargets: {
          prod: { host: "unused", port: 27, username: "unused", privateKeyPath: "C:/fake/key" },
          staging: { host: "staging.example.com", port: 27, username: "stag", privateKeyPath: "C:/fake/key" },
        },
        apiTimeoutMs: 15000,
        sshTimeoutMs: 10000,
      },
      {
        hasCommand: () => true,
        runSshScpWpCliProbe: async () => ({
          stagingSsh: { ok: true, message: "SSH_OK" },
          remotePath: { ok: true, message: "REMOTE_OK" },
          wpInstalled: { ok: true, message: "WP_OK" },
          wpCli: { reachable: true, available: true, message: "staging WP-CLI available" },
          httpProbe: { ok: true, message: "https://staging.example.com/wp-json/ returned 200" },
        }),
      },
    );

    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(report.checks.some((check) => check.id === "deployable-plugin" && check.status === "fail")).toBe(true);
  });

  it("fails git_deploy mode when .cpanel.yml is missing", async () => {
    const root = createMythoLikeWorkspace();
    const report = await runSourceCompatibilityCheck({
      apiToken: "token",
      user: "user",
      host: "host.example.com",
      apiBaseUrl: "https://host.example.com:2083",
      workflowMode: "git_deploy",
      domains: {},
      paths: { prod: "/home/prod/public_html" },
      sourceProfile: {
        localProjectRoot: root,
        localAppPath: "wordpress",
        sourceKind: "full_site",
        deployUnit: "raw_source",
        defaultReleaseIntent: "deploy",
      },
      safety: {
        requireStagingConfirm: true,
        warnDynamicDataSync: true,
        enforceStagingFirst: true,
      },
      sshTargets: {
        prod: { host: "prod-host", port: 27, username: "prod-user", privateKeyPath: "C:/fake/key" },
      },
      apiTimeoutMs: 15000,
      sshTimeoutMs: 10000,
    });

    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.id === "cpanel-yml" && check.status === "fail")).toBe(true);
  });
});
