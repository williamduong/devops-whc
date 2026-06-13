import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env";
import { WhcSshClient } from "../clients/ssh-client";
import { WpCliClient } from "../clients/wpcli-client";

type CheckStatus = "pass" | "warn" | "fail";

export interface SourceCompatibilityCheck {
  id: string;
  status: CheckStatus;
  message: string;
  details?: string;
  hint?: string;
}

export interface SourceCompatibilityReport {
  ok: boolean;
  ready_for_deploy: boolean;
  status: "ready" | "blocked";
  paths: {
    local_project_root: string;
    app_root: string;
    wp_content_path: string;
    build_artifact_path?: string;
  };
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  blockers: string[];
  warnings: string[];
  next_actions: string[];
  checks: SourceCompatibilityCheck[];
}

interface SshScpWpCliProbeReport {
  stagingSsh: {
    ok: boolean;
    message: string;
  };
  remotePath: {
    ok: boolean;
    message: string;
  };
  wpInstalled: {
    ok: boolean;
    message: string;
  };
  wpCli: {
    reachable: boolean;
    available: boolean;
    message: string;
  };
  httpProbe: {
    ok: boolean;
    message: string;
  };
}

export interface SourceCompatibilityDeps {
  hasCommand?: (command: string) => boolean;
  runSshScpWpCliProbe?: (config: AppConfig) => Promise<SshScpWpCliProbeReport>;
}

function isDir(targetPath: string): boolean {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
}

function isFile(targetPath: string): boolean {
  return fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();
}

function countByStatus(checks: SourceCompatibilityCheck[], status: CheckStatus): number {
  return checks.filter((check) => check.status === status).length;
}

function resolveWpContentPath(appRoot: string): string {
  if (path.basename(appRoot).toLowerCase() === "wp-content") {
    return appRoot;
  }
  return path.join(appRoot, "wp-content");
}

function defaultHasCommand(command: string): boolean {
  return command.length > 0 && process.env.PATH?.length !== 0
    ? !!process.env.PATH?.split(path.delimiter).some((segment) => {
      const fullPath = path.join(segment, process.platform === "win32" ? `${command}.exe` : command);
      return isFile(fullPath);
    })
    : false;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function containsPattern(filePath: string, pattern: RegExp): boolean {
  if (!isFile(filePath)) {
    return false;
  }
  return pattern.test(fs.readFileSync(filePath, "utf8"));
}

async function runDefaultSshScpWpCliProbe(config: AppConfig): Promise<SshScpWpCliProbeReport> {
  const stagingTarget = config.sshTargets.staging;
  const stagingPath = config.paths.staging;
  const stagingDomain = config.domains.staging;

  const blockedReport = {
    stagingSsh: {
      ok: false,
      message: "staging SSH target is not configured",
    },
    remotePath: {
      ok: false,
      message: "staging path is not configured",
    },
    wpInstalled: {
      ok: false,
      message: "staging path is not configured",
    },
    wpCli: {
      reachable: false,
      available: false,
      message: "staging SSH target is not configured",
    },
    httpProbe: {
      ok: false,
      message: "staging domain is not configured",
    },
  };

  if (!stagingTarget) {
    return blockedReport;
  }

  const sshClient = new WhcSshClient(config);
  const wpCliClient = new WpCliClient(config, sshClient);
  const runCommand = async (command: string): Promise<{ ok: boolean; message: string }> => {
    if (stagingTarget.privateKeyPath) {
      const result = await sshClient.execWithKey(
        {
          host: stagingTarget.host,
          port: stagingTarget.port,
          username: stagingTarget.username,
          privateKeyPath: stagingTarget.privateKeyPath,
        },
        command,
      );
      return {
        ok: result.ok,
        message: result.ok ? result.stdout || result.message : result.stderr || result.message,
      };
    }

    if (stagingTarget.password) {
      const result = await sshClient.execWithPassword(
        {
          host: stagingTarget.host,
          port: stagingTarget.port,
          username: stagingTarget.username,
          password: stagingTarget.password,
        },
        command,
      );
      return {
        ok: result.ok,
        message: result.ok ? result.stdout || result.message : result.stderr || result.message,
      };
    }

    return {
      ok: false,
      message: "staging SSH target is missing both private key and password auth",
    };
  };

  const stagingSsh = await runCommand("echo SSH_OK");
  const remotePath = stagingPath
    ? await runCommand(`test -d ${shellQuote(stagingPath)} && echo REMOTE_OK`)
    : { ok: false, message: "staging path is not configured" };
  const wpInstalled = stagingPath
    ? await runCommand(`wp --path=${shellQuote(stagingPath)} core is-installed >/dev/null 2>&1 && echo WP_OK`)
    : { ok: false, message: "staging path is not configured" };
  const wpCli = (await wpCliClient.probe()).staging;

  let httpProbe = {
    ok: false,
    message: "staging domain is not configured",
  };
  if (stagingDomain) {
    const probeUrl = stagingDomain.startsWith("http://") || stagingDomain.startsWith("https://")
      ? `${stagingDomain.replace(/\/+$/, "")}/wp-json/`
      : `https://${stagingDomain}/wp-json/`;
    try {
      const response = await fetch(probeUrl, { method: "GET" });
      httpProbe = {
        ok: response.status === 200,
        message: `${probeUrl} returned ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown HTTP probe error";
      httpProbe = {
        ok: false,
        message: `${probeUrl} failed: ${message}`,
      };
    }
  }

  return {
    stagingSsh,
    remotePath,
    wpInstalled,
    wpCli: {
      reachable: wpCli.reachable,
      available: wpCli.available,
      message: wpCli.message,
    },
    httpProbe,
  };
}

function pushGitDeployChecks(
  checks: SourceCompatibilityCheck[],
  config: AppConfig,
  localProjectRoot: string,
  appRoot: string,
  wpContentPath: string,
  buildArtifactPath: string | undefined,
): void {
  const sourceKind = config.sourceProfile.sourceKind;
  const deployUnit = config.sourceProfile.deployUnit;

  const recommendedUnitBySourceKind: Record<AppConfig["sourceProfile"]["sourceKind"], AppConfig["sourceProfile"]["deployUnit"]> = {
    full_site: "raw_source",
    partial_content: "raw_source",
    package_only: "package_bundle",
    artifact_first: "build_artifact",
    monorepo_slice: "raw_source",
  };
  const recommendedUnit = recommendedUnitBySourceKind[sourceKind];
  const cpanelYamlPath = path.join(localProjectRoot, ".cpanel.yml");
  checks.push({
    id: "deploy-unit-alignment",
    status: deployUnit === recommendedUnit ? "pass" : "warn",
    message:
      deployUnit === recommendedUnit
        ? "Configured deploy unit aligns with source layout."
        : "Configured deploy unit should be adjusted for current layout.",
    details: `Recommended deploy unit is ${recommendedUnit}.`,
  });

  checks.push({
    id: "cpanel-yml",
    status: isFile(cpanelYamlPath) ? "pass" : "fail",
    message: isFile(cpanelYamlPath) ? ".cpanel.yml is present for cPanel Git deployment." : ".cpanel.yml is missing.",
    details: cpanelYamlPath,
    hint: "Add .cpanel.yml at the repository root so cPanel Git deployment knows what to do after local git push.",
  });

  if (sourceKind === "full_site" || sourceKind === "partial_content" || sourceKind === "monorepo_slice") {
    checks.push({
      id: "wp-content-path",
      status: isDir(wpContentPath) ? "pass" : "fail",
      message: isDir(wpContentPath) ? "Required WordPress content path exists." : "Required WordPress content path is missing.",
      details: wpContentPath,
      hint: "Ensure wp-content exists under app_root (or set app_root directly to wp-content).",
    });
  }

  if (sourceKind === "full_site") {
    const hasWpLoad = isFile(path.join(appRoot, "wp-load.php"));
    const hasWpIncludes = isDir(path.join(appRoot, "wp-includes"));
    checks.push({
      id: "core-layout-markers",
      status: hasWpLoad || hasWpIncludes ? "pass" : "warn",
      message:
        hasWpLoad || hasWpIncludes
          ? "WordPress core markers are present."
          : "WordPress core markers were not found.",
      details: "Expected wp-load.php or wp-includes under app_root.",
    });
  }

  if (sourceKind === "partial_content") {
    const pluginsPath = path.join(wpContentPath, "plugins");
    const themesPath = path.join(wpContentPath, "themes");
    const hasPluginsOrThemes = isDir(pluginsPath) || isDir(themesPath);
    checks.push({
      id: "deploy-content-folders",
      status: hasPluginsOrThemes ? "pass" : "fail",
      message: hasPluginsOrThemes ? "Required content folders are present." : "Required content folders are missing.",
      details: `Checked ${pluginsPath} and ${themesPath}`,
    });
  }

  if (sourceKind === "package_only" || sourceKind === "artifact_first") {
    checks.push({
      id: "build-artifact-path",
      status: buildArtifactPath && (isDir(buildArtifactPath) || isFile(buildArtifactPath)) ? "pass" : "fail",
      message:
        buildArtifactPath && (isDir(buildArtifactPath) || isFile(buildArtifactPath))
          ? "Build artifact path exists."
          : "Build artifact path is missing.",
      details: buildArtifactPath ?? "(missing)",
      hint: "Set WHC_BUILD_ARTIFACT_PATH for package_only/artifact_first sources.",
    });
  }

  const wpConfigPath = path.join(appRoot, "wp-config.php");
  checks.push({
    id: "wp-config-runtime-state",
    status: isFile(wpConfigPath) ? "warn" : "pass",
    message: "Runtime config separation is healthy.",
    details: isFile(wpConfigPath)
      ? `Found ${wpConfigPath}`
      : "Not found under app_root.",
  });

  const uploadsPath = path.join(wpContentPath, "uploads");
  checks.push({
    id: "uploads-runtime-state",
    status: isDir(uploadsPath) ? "warn" : "pass",
    message: "Runtime uploads separation is healthy.",
    details: isDir(uploadsPath)
      ? `Found ${uploadsPath}`
      : "Not found under wp-content.",
  });

  if (!config.paths.staging) {
    checks.push({
      id: "staging-path",
      status: "warn",
      message: "Staging path is not configured.",
      hint: "Set WHC_STAGING_PATH to improve target-path guardrails for staging operations.",
    });
  }
}

async function pushSshScpWpCliChecks(
  checks: SourceCompatibilityCheck[],
  config: AppConfig,
  appRoot: string,
  wpContentPath: string,
  deps: SourceCompatibilityDeps,
): Promise<void> {
  const hasCommand = deps.hasCommand ?? defaultHasCommand;
  const pluginEntry = path.join(wpContentPath, "plugins", "mytho-core", "mytho-core.php");
  const themeStyle = path.join(wpContentPath, "themes", "mytho-child", "style.css");
  const seedScript = path.join(appRoot, "scripts", "seed-local-sample-data.php");
  const probe = await (deps.runSshScpWpCliProbe ?? runDefaultSshScpWpCliProbe)(config);

  checks.push({
    id: "deploy-unit-alignment",
    status: config.sourceProfile.deployUnit === "raw_source" ? "pass" : "fail",
    message:
      config.sourceProfile.deployUnit === "raw_source"
        ? "Configured deploy unit matches SSH/SCP source delivery."
        : "Configured deploy unit does not match SSH/SCP source delivery.",
    details: `Detected deploy unit: ${config.sourceProfile.deployUnit}`,
    hint: "Set WHC_DEPLOY_UNIT=raw_source for mytho/source SSH-SCP deploys.",
  });

  checks.push({
    id: "wp-content-path",
    status: isDir(wpContentPath) ? "pass" : "fail",
    message: isDir(wpContentPath) ? "WordPress content path exists." : "WordPress content path is missing.",
    details: wpContentPath,
    hint: "Set WHC_LOCAL_APP_PATH to the local WordPress root that contains wp-content.",
  });

  checks.push({
    id: "deployable-plugin",
    status: containsPattern(pluginEntry, /Plugin Name:/) ? "pass" : "fail",
    message:
      containsPattern(pluginEntry, /Plugin Name:/)
        ? "Deployable plugin entrypoint is present."
        : "Deployable plugin entrypoint is missing or malformed.",
    details: pluginEntry,
    hint: "Expected wordpress/wp-content/plugins/mytho-core/mytho-core.php with a Plugin Name header.",
  });

  checks.push({
    id: "deployable-theme",
    status: containsPattern(themeStyle, /Theme Name:/) ? "pass" : "fail",
    message:
      containsPattern(themeStyle, /Theme Name:/)
        ? "Deployable theme entrypoint is present."
        : "Deployable theme entrypoint is missing or malformed.",
    details: themeStyle,
    hint: "Expected wordpress/wp-content/themes/mytho-child/style.css with a Theme Name header.",
  });

  const seedHasGuard = containsPattern(
    seedScript,
    /idempotent|get_page_by_path|post_exists|wc_get_product|term_exists/,
  );
  checks.push({
    id: "seed-script-idempotency",
    status: seedHasGuard ? "pass" : "fail",
    message: seedHasGuard ? "Seed script includes idempotency guards." : "Seed script is missing idempotency guards.",
    details: seedScript,
    hint: "Add get_page_by_path/post_exists/wc_get_product/term_exists or an explicit idempotent marker in the seed script.",
  });

  checks.push({
    id: "wp-config-runtime-state",
    status: isFile(path.join(appRoot, "wp-config.php")) ? "pass" : "warn",
    message: "Local runtime config layout matches the current mytho/source workflow.",
    details: isFile(path.join(appRoot, "wp-config.php"))
      ? "wp-config.php is present locally; this is expected for mytho/source today."
      : "wp-config.php not found under app_root.",
  });

  checks.push({
    id: "uploads-runtime-state",
    status: isDir(path.join(wpContentPath, "uploads")) ? "pass" : "warn",
    message: "Local writable content layout matches the current mytho/source workflow.",
    details: isDir(path.join(wpContentPath, "uploads"))
      ? "uploads/ is present locally; this is expected for mytho/source today."
      : "uploads/ not found under wp-content.",
  });

  checks.push({
    id: "local-ssh-command",
    status: hasCommand("ssh") ? "pass" : "fail",
    message: hasCommand("ssh") ? "Local ssh command is available." : "Local ssh command is missing.",
    hint: "Install OpenSSH client or ensure ssh is available in PATH.",
  });

  checks.push({
    id: "local-scp-command",
    status: hasCommand("scp") ? "pass" : "fail",
    message: hasCommand("scp") ? "Local scp command is available." : "Local scp command is missing.",
    hint: "Install OpenSSH client or ensure scp is available in PATH.",
  });

  checks.push({
    id: "staging-target-config",
    status: config.sshTargets.staging ? "pass" : "fail",
    message: config.sshTargets.staging ? "Staging SSH target is configured." : "Staging SSH target is missing.",
    hint: "Set WHC_STAGING_SSH_HOST, WHC_STAGING_SSH_USERNAME, and either WHC_STAGING_SSH_PRIVATE_KEY_PATH or WHC_STAGING_SSH_PASSWORD.",
  });

  checks.push({
    id: "staging-path",
    status: config.paths.staging ? "pass" : "fail",
    message: config.paths.staging ? "Staging remote path is configured." : "Staging remote path is missing.",
    details: config.paths.staging ?? "(missing)",
    hint: "Set WHC_STAGING_PATH to the WordPress root used by wp --path on staging.",
  });

  checks.push({
    id: "staging-domain",
    status: config.domains.staging ? "pass" : "fail",
    message: config.domains.staging ? "Staging domain is configured." : "Staging domain is missing.",
    details: config.domains.staging ?? "(missing)",
    hint: "Set WHC_STAGING_DOMAIN so the HTTP smoke probe can validate /wp-json/.",
  });

  checks.push({
    id: "staging-ssh-connectivity",
    status: probe.stagingSsh.ok ? "pass" : "fail",
    message: probe.stagingSsh.ok ? "Staging SSH connectivity is healthy." : "Staging SSH connectivity failed.",
    details: probe.stagingSsh.message,
    hint: "Verify staging SSH auth, host, port, and private key/password configuration.",
  });

  checks.push({
    id: "staging-remote-path",
    status: probe.remotePath.ok ? "pass" : "fail",
    message: probe.remotePath.ok ? "Staging remote path exists." : "Staging remote path check failed.",
    details: probe.remotePath.message,
    hint: "Confirm WHC_STAGING_PATH points to the actual staging WordPress root.",
  });

  checks.push({
    id: "staging-wp-installed",
    status: probe.wpInstalled.ok ? "pass" : "fail",
    message: probe.wpInstalled.ok ? "Remote WordPress install is detected." : "Remote WordPress install check failed.",
    details: probe.wpInstalled.message,
    hint: "Run wp core is-installed manually on staging and verify the configured path.",
  });

  checks.push({
    id: "staging-wpcli",
    status: probe.wpCli.reachable && probe.wpCli.available ? "pass" : "fail",
    message:
      probe.wpCli.reachable && probe.wpCli.available
        ? "Staging WP-CLI is reachable."
        : "Staging WP-CLI is not ready.",
    details: probe.wpCli.message,
    hint: "Ensure WP-CLI is installed on staging and accessible to the configured SSH user.",
  });

  checks.push({
    id: "staging-http-probe",
    status: probe.httpProbe.ok ? "pass" : "fail",
    message: probe.httpProbe.ok ? "Staging HTTP probe returned 200." : "Staging HTTP probe failed.",
    details: probe.httpProbe.message,
    hint: "Check the staging domain and confirm /wp-json/ responds with HTTP 200 before deploy.",
  });
}

export async function runSourceCompatibilityCheck(
  config: AppConfig,
  deps: SourceCompatibilityDeps = {},
): Promise<SourceCompatibilityReport> {
  const checks: SourceCompatibilityCheck[] = [];

  const localProjectRoot = path.resolve(config.sourceProfile.localProjectRoot ?? process.cwd());
  const appRoot = path.resolve(localProjectRoot, config.sourceProfile.localAppPath ?? ".");
  const wpContentPath = resolveWpContentPath(appRoot);
  const buildArtifactPath = config.sourceProfile.buildArtifactPath
    ? path.resolve(localProjectRoot, config.sourceProfile.buildArtifactPath)
    : undefined;

  checks.push({
    id: "workflow-mode",
    status: config.workflowMode === "git_deploy" || config.workflowMode === "ssh_scp_wpcli" ? "pass" : "fail",
    message: "Workflow mode is compatible.",
    details: `Detected workflow mode: ${config.workflowMode}`,
  });

  checks.push({
    id: "project-root",
    status: isDir(localProjectRoot) ? "pass" : "fail",
    message: isDir(localProjectRoot) ? "Project root path is valid." : "Project root path is missing.",
    details: localProjectRoot,
    hint: "Set WHC_LOCAL_PROJECT_ROOT to your repository root.",
  });

  checks.push({
    id: "app-root",
    status: isDir(appRoot) ? "pass" : "fail",
    message: isDir(appRoot) ? "Application root path is valid." : "Application root path is missing.",
    details: appRoot,
    hint: "Set WHC_LOCAL_APP_PATH to the WordPress app folder (or leave empty for repo root).",
  });

  if (config.workflowMode === "ssh_scp_wpcli") {
    await pushSshScpWpCliChecks(checks, config, appRoot, wpContentPath, deps);
  } else {
    pushGitDeployChecks(checks, config, localProjectRoot, appRoot, wpContentPath, buildArtifactPath);
  }

  const failCount = countByStatus(checks, "fail");
  const warnCount = countByStatus(checks, "warn");
  const passCount = countByStatus(checks, "pass");

  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.hint ?? check.details ?? check.message);

  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => check.hint ?? check.details ?? check.message);

  const nextActions: string[] = [];
  if (failCount > 0) {
    nextActions.push(...blockers);
    nextActions.push("Re-run check-generic after fixing blockers.");
  } else if (warnCount > 0) {
    nextActions.push("Deploy can proceed, but review warnings to reduce risk.");
    nextActions.push(...warnings);
  } else {
    nextActions.push("Ready for deploy. Proceed with your deploy pipeline.");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const uniqueNextActions = [...new Set(nextActions)];

  return {
    ok: failCount === 0,
    ready_for_deploy: failCount === 0,
    status: failCount === 0 ? "ready" : "blocked",
    paths: {
      local_project_root: localProjectRoot,
      app_root: appRoot,
      wp_content_path: wpContentPath,
      build_artifact_path: buildArtifactPath,
    },
    summary: {
      pass: passCount,
      warn: warnCount,
      fail: failCount,
    },
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    next_actions: uniqueNextActions,
    checks,
  };
}
