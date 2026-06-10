import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppConfig } from "../config/env";
import { KeySshTarget, WhcSshClient } from "./ssh-client";

const execFileAsync = promisify(execFile);
const WPCLI_CHECK_COMMAND = 'if command -v wp >/dev/null 2>&1; then wp --info | head -n 1; else echo __WPCLI_NOT_FOUND__; fi';

export interface WpCliEnvironmentCapability {
  reachable: boolean;
  available: boolean;
  latencyMs: number;
  message: string;
  versionLine?: string;
}

export interface WpCliCapabilityReport {
  prod: WpCliEnvironmentCapability;
  staging: WpCliEnvironmentCapability;
}

export class WpCliClient {
  constructor(
    private readonly config: AppConfig,
    private readonly sshClient: WhcSshClient,
  ) {}

  async probe(): Promise<WpCliCapabilityReport> {
    const prod = await this.probeWithKey(this.config.sshTargets.prod, "production");
    const staging = await this.probeStaging();
    return { prod, staging };
  }

  private async probeWithKey(target: KeySshTarget, envLabel: string): Promise<WpCliEnvironmentCapability> {
    const result = await this.sshClient.execWithKey(target, WPCLI_CHECK_COMMAND);
    if (!result.ok && result.stdout.length === 0) {
      return {
        reachable: false,
        available: false,
        latencyMs: result.latencyMs,
        message: `${envLabel} SSH command failed: ${result.message}`,
      };
    }

    if (result.stdout.includes("__WPCLI_NOT_FOUND__")) {
      return {
        reachable: true,
        available: false,
        latencyMs: result.latencyMs,
        message: `${envLabel} reachable but WP-CLI is not installed or not in PATH`,
      };
    }

    return {
      reachable: true,
      available: true,
      latencyMs: result.latencyMs,
      message: `${envLabel} WP-CLI available`,
      versionLine: result.stdout.split("\n")[0],
    };
  }

  private async probeStaging(): Promise<WpCliEnvironmentCapability> {
    const stagingTarget = this.config.sshTargets.staging;
    if (!stagingTarget) {
      return {
        reachable: false,
        available: false,
        latencyMs: 0,
        message: "staging SSH target is not configured",
      };
    }

    if (stagingTarget.privateKeyPath) {
      return this.probeWithKey(
        {
          host: stagingTarget.host,
          port: stagingTarget.port,
          username: stagingTarget.username,
          privateKeyPath: stagingTarget.privateKeyPath,
        },
        "staging",
      );
    }

    if (!stagingTarget.password) {
      return {
        reachable: false,
        available: false,
        latencyMs: 0,
        message: "staging key not set and staging password not configured",
      };
    }

    const startedAt = Date.now();
    const args = [
      "-ssh",
      "-batch",
      "-P",
      String(stagingTarget.port),
      "-l",
      stagingTarget.username,
      "-pw",
      stagingTarget.password,
    ];

    if (stagingTarget.hostKey) {
      args.push("-hostkey", stagingTarget.hostKey);
    }

    args.push(stagingTarget.host, WPCLI_CHECK_COMMAND);

    try {
      const { stdout } = await execFileAsync("plink", args, {
        timeout: this.config.sshTimeoutMs,
        windowsHide: true,
      });
      const latencyMs = Date.now() - startedAt;
      const output = stdout.trim();

      if (output.includes("__WPCLI_NOT_FOUND__")) {
        return {
          reachable: true,
          available: false,
          latencyMs,
          message: "staging reachable but WP-CLI is not installed or not in PATH",
        };
      }

      return {
        reachable: true,
        available: output.length > 0,
        latencyMs,
        message: output.length > 0 ? "staging WP-CLI available" : "staging reachable but WP-CLI check returned empty output",
        versionLine: output.split("\n")[0] || undefined,
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "unknown staging WP-CLI probe error";
      const hostKeyHint = stagingTarget.hostKey
        ? ""
        : " (tip: set WHC_STAGING_SSH_HOSTKEY to avoid first-time hostkey trust blocks)";

      return {
        reachable: false,
        available: false,
        latencyMs,
        message: `staging WP-CLI probe failed: ${message}${hostKeyHint}`,
      };
    }
  }
}