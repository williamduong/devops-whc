import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";

describe("loadConfig", () => {
  it("loads valid git_deploy env values without forcing prod SSH credentials", () => {
    const config = loadConfig({
      WHC_API_TOKEN: "token",
      WHC_USER: "user",
      WHC_HOST: "host.example.com",
      WHC_WORKFLOW_MODE: "git_deploy",
      WHC_PRIMARY_DOMAIN: "site1780410877.mywhc.ca",
      WHC_TESTING_DOMAIN: "wp290886.wpdns.ca",
      WHC_STAGING_DOMAIN: "staging-wp290886.wpdns.ca",
      WHC_PROD_PATH: "/home/user/public_html",
      WHC_STAGING_PATH: "/home/user/staging",
      WHC_REQUIRE_STAGING_CONFIRM: "true",
      WHC_WARN_DYNAMIC_DATA_SYNC: "true",
      WHC_STAGING_SSH_HOST: "23.27.253.64",
      WHC_STAGING_SSH_PORT: "27",
      WHC_STAGING_SSH_USERNAME: "stag290886",
      WHC_API_TIMEOUT_MS: "15000",
      WHC_SSH_TIMEOUT_MS: "10000",
      WHC_FLOW_LOG_PATH: ".whc/logs/custom-flow.jsonl",
    });

    expect(config.apiBaseUrl).toBe("https://host.example.com:2083");
    expect(config.sshTargets.prod.port).toBe(27);
    expect(config.workflowMode).toBe("git_deploy");
    expect(config.paths.prod).toBe("/home/user/public_html");
    expect(config.safety.requireStagingConfirm).toBe(true);
    expect(config.safety.warnDynamicDataSync).toBe(true);
    expect(config.safety.enforceStagingFirst).toBe(true);
    expect(config.sshTargets.prod.host).toBe("host.example.com");
    expect(config.sshTargets.prod.username).toBe("user");
    expect(config.sshTargets.staging?.host).toBe("23.27.253.64");
    expect(config.sourceProfile.sourceKind).toBe("full_site");
    expect(config.sourceProfile.deployUnit).toBe("raw_source");
    expect(config.sourceProfile.defaultReleaseIntent).toBe("deploy");
    expect(config.flowLogPath).toBe(".whc/logs/custom-flow.jsonl");
  });

  it("loads ssh_scp_wpcli mode with staging-only credentials", () => {
    const config = loadConfig({
      WHC_WORKFLOW_MODE: "ssh_scp_wpcli",
      WHC_STAGING_DOMAIN: "staging.example.com",
      WHC_STAGING_PATH: "/home/staging/public_html",
      WHC_STAGING_SSH_HOST: "23.27.253.64",
      WHC_STAGING_SSH_PORT: "27",
      WHC_STAGING_SSH_USERNAME: "stag290886",
      WHC_STAGING_SSH_PRIVATE_KEY_PATH: "C:/fake/staging-key",
      WHC_API_TIMEOUT_MS: "15000",
      WHC_SSH_TIMEOUT_MS: "10000",
    });

    expect(config.workflowMode).toBe("ssh_scp_wpcli");
    expect(config.sshTargets.staging?.host).toBe("23.27.253.64");
    expect(config.sshTargets.prod.host).toBe("23.27.253.64");
    expect(config.apiBaseUrl).toBe("");
  });

  it("defaults to ssh_scp_wpcli when workflow mode is omitted", () => {
    const config = loadConfig({
      WHC_STAGING_DOMAIN: "staging.example.com",
      WHC_STAGING_PATH: "/home/staging/public_html",
      WHC_STAGING_SSH_HOST: "23.27.253.64",
      WHC_STAGING_SSH_PORT: "27",
      WHC_STAGING_SSH_USERNAME: "stag290886",
      WHC_STAGING_SSH_PRIVATE_KEY_PATH: "C:/fake/staging-key",
      WHC_API_TIMEOUT_MS: "15000",
      WHC_SSH_TIMEOUT_MS: "10000",
    });

    expect(config.workflowMode).toBe("ssh_scp_wpcli");
  });

  it("throws validation error when required values are missing", () => {
    expect(() => loadConfig({})).toThrowError(/VALIDATION_ERROR/);
  });
});
