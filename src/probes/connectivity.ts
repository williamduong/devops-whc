import { AppConfig } from "../config/env";
import { WhcSshClient } from "../clients/ssh-client";
import { WpCliClient } from "../clients/wpcli-client";
import { WhcUapiClient } from "../clients/whc-uapi-client";

export interface ConnectivityProbeReport {
  uapi: {
    ok: boolean;
    latencyMs: number;
    message: string;
    status?: number;
  };
  ssh: {
    ok: boolean;
    latencyMs: number;
    message: string;
  };
  sshEnvironments: {
    prod: {
      ok: boolean;
      latencyMs: number;
      message: string;
    };
    staging: {
      ok: boolean;
      latencyMs: number;
      message: string;
    };
  };
  wpcli: {
    prod: {
      reachable: boolean;
      available: boolean;
      latencyMs: number;
      message: string;
      versionLine?: string;
    };
    staging: {
      reachable: boolean;
      available: boolean;
      latencyMs: number;
      message: string;
      versionLine?: string;
    };
  };
}

export async function runConnectivityProbe(config: AppConfig): Promise<ConnectivityProbeReport> {
  const uapiClient = new WhcUapiClient(config);
  const sshClient = new WhcSshClient(config);
  const wpCliClient = new WpCliClient(config, sshClient);

  const [uapi, prodSsh, wpcli] = await Promise.all([uapiClient.probe(), sshClient.probe(), wpCliClient.probe()]);

  let stagingSsh = {
    ok: false,
    latencyMs: 0,
    message: "staging SSH key target not configured",
  };

  if (config.sshTargets.staging?.privateKeyPath) {
    stagingSsh = await sshClient.probeTarget({
      host: config.sshTargets.staging.host,
      port: config.sshTargets.staging.port,
      username: config.sshTargets.staging.username,
      privateKeyPath: config.sshTargets.staging.privateKeyPath,
    });
  } else if (config.sshTargets.staging) {
    stagingSsh = {
      ok: false,
      latencyMs: 0,
      message: "staging SSH uses password mode; key-based SSH probe skipped",
    };
  }

  return {
    uapi,
    ssh: prodSsh,
    sshEnvironments: {
      prod: prodSsh,
      staging: stagingSsh,
    },
    wpcli,
  };
}
