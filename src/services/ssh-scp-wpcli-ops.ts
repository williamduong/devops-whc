import { AppConfig } from "../config/env";
import { WhcSshClient, KeySshTarget, SftpUploadResult } from "../clients/ssh-client";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScpSyncResult {
  ok: boolean;
  uploaded: number;
  failed: number;
  message: string;
}

export interface WpCliStepResult {
  ok: boolean;
  step: string;
  message: string;
  stdout?: string;
}

export interface DbMigrationResult {
  ok: boolean;
  searchReplaceDryRun: WpCliStepResult;
  searchReplace: WpCliStepResult;
  cacheFlush: WpCliStepResult;
  rewriteFlush: WpCliStepResult;
  transientCleanup: WpCliStepResult;
}

export interface SeedBootstrapResult {
  ok: boolean;
  message: string;
  stdout?: string;
}

export interface SmokeGateResult {
  ok: boolean;
  url: string;
  statusCode: number;
  message: string;
}

export interface SshScpWpCliPipelineResult {
  ok: boolean;
  scpSync: ScpSyncResult;
  wpCliBootstrap: WpCliStepResult[];
  dbMigration?: DbMigrationResult;
  seedBootstrap?: SeedBootstrapResult;
  smokeGate?: SmokeGateResult;
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveStagingTarget(config: AppConfig): KeySshTarget | null {
  const st = config.sshTargets.staging;
  if (!st || !st.privateKeyPath) return null;
  return {
    host: st.host,
    port: st.port,
    username: st.username,
    privateKeyPath: st.privateKeyPath,
  };
}

function resolveStagingPath(config: AppConfig): string | null {
  return config.paths.staging ?? null;
}

function wpCmd(path: string, command: string): string {
  return `wp --path='${path.replace(/'/g, `'"'"'`)}' ${command}`;
}

// ── Phase 3: SCP Code Sync ──────────────────────────────────────────────────

export async function runScpCodeSync(
  config: AppConfig,
  sshClient: WhcSshClient,
  localDir: string,
  remoteSubDir?: string,
): Promise<ScpSyncResult> {
  const target = resolveStagingTarget(config);
  if (!target) {
    return { ok: false, uploaded: 0, failed: 0, message: "Staging SSH target is not configured." };
  }
  const remotePath = resolveStagingPath(config);
  if (!remotePath) {
    return { ok: false, uploaded: 0, failed: 0, message: "Staging remote path is not configured." };
  }

  const destPath = remoteSubDir
    ? `${remotePath.replace(/\/$/, "")}/${remoteSubDir.replace(/^\//, "")}`
    : remotePath;

  const result: SftpUploadResult = await sshClient.sftpUploadDir(target, localDir, destPath);
  return {
    ok: result.ok,
    uploaded: result.uploaded,
    failed: result.failed,
    message: result.message,
  };
}

// ── Phase 4: WP-CLI Runtime Bootstrap ───────────────────────────────────────

export async function runWpCliActivatePlugin(
  config: AppConfig,
  sshClient: WhcSshClient,
  pluginName: string,
): Promise<WpCliStepResult> {
  const target = resolveStagingTarget(config);
  const remotePath = resolveStagingPath(config);
  if (!target || !remotePath) {
    return { ok: false, step: `activate_plugin:${pluginName}`, message: "Staging target/path not configured." };
  }

  const cmd = wpCmd(remotePath, `plugin activate ${pluginName} --quiet 2>&1`);
  const result = await sshClient.execWithKey(target, cmd);
  return {
    ok: result.ok,
    step: `activate_plugin:${pluginName}`,
    message: result.ok ? `Plugin ${pluginName} activated.` : (result.stderr || result.message),
    stdout: result.stdout,
  };
}

export async function runWpCliActivateTheme(
  config: AppConfig,
  sshClient: WhcSshClient,
  themeName: string,
): Promise<WpCliStepResult> {
  const target = resolveStagingTarget(config);
  const remotePath = resolveStagingPath(config);
  if (!target || !remotePath) {
    return { ok: false, step: `activate_theme:${themeName}`, message: "Staging target/path not configured." };
  }

  const cmd = wpCmd(remotePath, `theme activate ${themeName} --quiet 2>&1`);
  const result = await sshClient.execWithKey(target, cmd);
  return {
    ok: result.ok,
    step: `activate_theme:${themeName}`,
    message: result.ok ? `Theme ${themeName} activated.` : (result.stderr || result.message),
    stdout: result.stdout,
  };
}

// ── Phase 4b: DB Migration (WordPress Standard) ─────────────────────────────

/**
 * WordPress database migration following official best practices:
 * 1. wp search-replace --dry-run (preview)
 * 2. wp search-replace --all-tables --skip-columns=guid --skip-tables=wp_users
 * 3. wp cache flush
 * 4. wp rewrite flush
 * 5. wp transient delete --all
 *
 * Ref: https://developer.wordpress.org/cli/commands/search-replace/
 * Ref: https://developer.wordpress.org/advanced-administration/upgrade/migrating/
 */
export async function runDbMigration(
  config: AppConfig,
  sshClient: WhcSshClient,
  oldUrl: string,
  newUrl: string,
): Promise<DbMigrationResult> {
  const target = resolveStagingTarget(config);
  const remotePath = resolveStagingPath(config);
  const notConfigured: WpCliStepResult = { ok: false, step: "", message: "Staging target/path not configured." };

  if (!target || !remotePath) {
    return {
      ok: false,
      searchReplaceDryRun: { ...notConfigured, step: "search_replace_dry_run" },
      searchReplace: { ...notConfigured, step: "search_replace" },
      cacheFlush: { ...notConfigured, step: "cache_flush" },
      rewriteFlush: { ...notConfigured, step: "rewrite_flush" },
      transientCleanup: { ...notConfigured, step: "transient_cleanup" },
    };
  }

  // Step 1: Dry-run search-replace first (safety check)
  const dryRunCmd = wpCmd(
    remotePath,
    `search-replace '${oldUrl}' '${newUrl}' --all-tables --skip-columns=guid --skip-tables=wp_users --dry-run --format=count 2>&1`,
  );
  const dryRunResult = await sshClient.execWithKey(target, dryRunCmd);
  const searchReplaceDryRun: WpCliStepResult = {
    ok: dryRunResult.ok,
    step: "search_replace_dry_run",
    message: dryRunResult.ok
      ? `Dry-run search-replace completed: ${dryRunResult.stdout || "0 replacements"}`
      : (dryRunResult.stderr || dryRunResult.message),
    stdout: dryRunResult.stdout,
  };

  // Step 2: Actual search-replace
  const srCmd = wpCmd(
    remotePath,
    `search-replace '${oldUrl}' '${newUrl}' --all-tables --skip-columns=guid --skip-tables=wp_users --quiet --report-changed-only 2>&1`,
  );
  const srResult = await sshClient.execWithKey(target, srCmd);
  const searchReplace: WpCliStepResult = {
    ok: srResult.ok,
    step: "search_replace",
    message: srResult.ok
      ? `Search-replace completed: ${srResult.stdout || "success"}`
      : (srResult.stderr || srResult.message),
    stdout: srResult.stdout,
  };

  // Step 3: Cache flush
  const cacheCmd = wpCmd(remotePath, `cache flush 2>&1`);
  const cacheResult = await sshClient.execWithKey(target, cacheCmd);
  const cacheFlush: WpCliStepResult = {
    ok: cacheResult.ok,
    step: "cache_flush",
    message: cacheResult.ok ? "Cache flushed." : (cacheResult.stderr || cacheResult.message),
    stdout: cacheResult.stdout,
  };

  // Step 4: Rewrite flush
  const rewriteCmd = wpCmd(remotePath, `rewrite flush --quiet 2>&1`);
  const rewriteResult = await sshClient.execWithKey(target, rewriteCmd);
  const rewriteFlush: WpCliStepResult = {
    ok: rewriteResult.ok,
    step: "rewrite_flush",
    message: rewriteResult.ok ? "Rewrite rules flushed." : (rewriteResult.stderr || rewriteResult.message),
    stdout: rewriteResult.stdout,
  };

  // Step 5: Transient cleanup
  const transientCmd = wpCmd(remotePath, `transient delete --all 2>&1`);
  const transientResult = await sshClient.execWithKey(target, transientCmd);
  const transientCleanup: WpCliStepResult = {
    ok: transientResult.ok,
    step: "transient_cleanup",
    message: transientResult.ok ? "Transients deleted." : (transientResult.stderr || transientResult.message),
    stdout: transientResult.stdout,
  };

  const allOk = searchReplaceDryRun.ok && searchReplace.ok && cacheFlush.ok && rewriteFlush.ok && transientCleanup.ok;

  return {
    ok: allOk,
    searchReplaceDryRun,
    searchReplace,
    cacheFlush,
    rewriteFlush,
    transientCleanup,
  };
}

// ── Phase 5: Seed / Bootstrap ───────────────────────────────────────────────

export async function runSeedBootstrap(
  config: AppConfig,
  sshClient: WhcSshClient,
  seedScriptPath: string,
): Promise<SeedBootstrapResult> {
  const target = resolveStagingTarget(config);
  const remotePath = resolveStagingPath(config);
  if (!target || !remotePath) {
    return { ok: false, message: "Staging target/path not configured." };
  }

  const cmd = wpCmd(remotePath, `eval-file '${seedScriptPath.replace(/'/g, `'"'"'`)}' 2>&1`);
  const result = await sshClient.execWithKey(target, cmd);

  return {
    ok: result.ok,
    message: result.ok ? "Seed/bootstrap completed." : (result.stderr || result.message),
    stdout: result.stdout,
  };
}

// ── Phase 6: Smoke Gate ─────────────────────────────────────────────────────

export async function runSmokeGate(
  config: AppConfig,
  environment: "live" | "staging",
): Promise<SmokeGateResult> {
  const domain = environment === "staging"
    ? config.domains.staging
    : config.domains.primary;

  if (!domain) {
    return {
      ok: false,
      url: "",
      statusCode: 0,
      message: `${environment} domain is not configured.`,
    };
  }

  const baseUrl = domain.startsWith("http://") || domain.startsWith("https://")
    ? domain.replace(/\/+$/, "")
    : `https://${domain}`;
  const probeUrl = `${baseUrl}/wp-json/`;

  try {
    const response = await fetch(probeUrl, { method: "GET" });
    return {
      ok: response.status === 200,
      url: probeUrl,
      statusCode: response.status,
      message: response.status === 200
        ? `Smoke gate passed: ${probeUrl} returned 200.`
        : `Smoke gate failed: ${probeUrl} returned ${response.status}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown HTTP error";
    return {
      ok: false,
      url: probeUrl,
      statusCode: 0,
      message: `Smoke gate failed: ${message}`,
    };
  }
}

// ── Full Pipeline Orchestrator ──────────────────────────────────────────────

export interface SshScpWpCliPipelineInput {
  localSourceDir?: string;
  remoteSubDir?: string;
  pluginsToActivate?: string[];
  themeToActivate?: string;
  dbOldUrl?: string;
  dbNewUrl?: string;
  seedScriptPath?: string;
  runSmoke?: boolean;
  smokeEnvironment?: "live" | "staging";
}

export async function runSshScpWpCliPipeline(
  config: AppConfig,
  sshClient: WhcSshClient,
  input: SshScpWpCliPipelineInput,
): Promise<SshScpWpCliPipelineResult> {
  const warnings: string[] = [];

  // Phase 3: SCP code sync
  let scpSync: ScpSyncResult;
  if (input.localSourceDir) {
    scpSync = await runScpCodeSync(config, sshClient, input.localSourceDir, input.remoteSubDir);
  } else {
    scpSync = { ok: true, uploaded: 0, failed: 0, message: "No local source dir provided; skipping SCP sync." };
    warnings.push("SCP code sync skipped: no local source directory provided.");
  }

  // Phase 4a: WP-CLI bootstrap (activate plugins/themes)
  const wpCliBootstrap: WpCliStepResult[] = [];
  if (input.pluginsToActivate) {
    for (const plugin of input.pluginsToActivate) {
      wpCliBootstrap.push(await runWpCliActivatePlugin(config, sshClient, plugin));
    }
  }
  if (input.themeToActivate) {
    wpCliBootstrap.push(await runWpCliActivateTheme(config, sshClient, input.themeToActivate));
  }

  // Phase 4b: DB Migration (search-replace, cache, rewrite, transients)
  let dbMigration: DbMigrationResult | undefined;
  if (input.dbOldUrl && input.dbNewUrl) {
    dbMigration = await runDbMigration(config, sshClient, input.dbOldUrl, input.dbNewUrl);
  }

  // Phase 5: Seed/bootstrap
  let seedBootstrap: SeedBootstrapResult | undefined;
  if (input.seedScriptPath) {
    seedBootstrap = await runSeedBootstrap(config, sshClient, input.seedScriptPath);
  }

  // Phase 6: Smoke gate
  let smokeGate: SmokeGateResult | undefined;
  if (input.runSmoke) {
    smokeGate = await runSmokeGate(config, input.smokeEnvironment ?? "staging");
  }

  const allOk =
    scpSync.ok &&
    wpCliBootstrap.every((s) => s.ok) &&
    (!dbMigration || dbMigration.ok) &&
    (!seedBootstrap || seedBootstrap.ok) &&
    (!smokeGate || smokeGate.ok);

  return {
    ok: allOk,
    scpSync,
    wpCliBootstrap,
    dbMigration,
    seedBootstrap,
    smokeGate,
    warnings,
  };
}
