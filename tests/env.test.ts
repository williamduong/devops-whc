import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env";

describe("loadConfig", () => {
  it("loads valid env values with explicit prod/staging SSH targets", () => {
    const config = loadConfig({
      WHC_API_TOKEN: "token",
      WHC_USER: "user",
      WHC_HOST: "host.example.com",
      WHC_WORKFLOW_MODE: "managed_clone_sync",
      WHC_PRIMARY_DOMAIN: "site1780410877.mywhc.ca",
      WHC_TESTING_DOMAIN: "wp290886.wpdns.ca",
      WHC_STAGING_DOMAIN: "staging-wp290886.wpdns.ca",
      WHC_PROD_PATH: "/home/user/public_html",
      WHC_STAGING_PATH: "/home/user/staging",
      WHC_REQUIRE_STAGING_CONFIRM: "true",
      WHC_WARN_DYNAMIC_DATA_SYNC: "true",
      WHC_ALLOW_STAGING_GIT_CONTROLLED: "true",
      WHC_PROD_SSH_HOST: "prod-ssh.example.com",
      WHC_PROD_SSH_PORT: "27",
      WHC_PROD_SSH_USERNAME: "produser",
      WHC_PROD_SSH_PRIVATE_KEY_PATH: "C:/fake/prod-key",
      WHC_STAGING_SSH_HOST: "23.27.253.64",
      WHC_STAGING_SSH_PORT: "27",
      WHC_STAGING_SSH_USERNAME: "stag290886",
      WHC_API_TIMEOUT_MS: "15000",
      WHC_SSH_TIMEOUT_MS: "10000",
      WHC_FLOW_LOG_PATH: ".whc/logs/custom-flow.jsonl",
    });

    expect(config.apiBaseUrl).toBe("https://host.example.com:2083");
    expect(config.sshTargets.prod.port).toBe(27);
    expect(config.workflowMode).toBe("managed_clone_sync");
    expect(config.paths.prod).toBe("/home/user/public_html");
    expect(config.safety.requireStagingConfirm).toBe(true);
    expect(config.safety.warnDynamicDataSync).toBe(true);
    expect(config.safety.enforceStagingFirst).toBe(true);
    expect(config.sshTargets.prod.host).toBe("prod-ssh.example.com");
    expect(config.sshTargets.staging?.host).toBe("23.27.253.64");
    expect(config.sourceProfile.sourceKind).toBe("full_site");
    expect(config.sourceProfile.deployUnit).toBe("raw_source");
    expect(config.sourceProfile.defaultReleaseIntent).toBe("deploy");
    expect(config.flowLogPath).toBe(".whc/logs/custom-flow.jsonl");
  });

  it("throws validation error when required values are missing", () => {
    expect(() => loadConfig({})).toThrowError(/VALIDATION_ERROR/);
  });
});
