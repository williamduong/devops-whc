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
  optionUpdateHome: WpCliStepResult;
  optionUpdateSiteurl: WpCliStepResult;
  searchReplaceDryRun: WpCliStepResult;
  searchReplace: WpCliStepResult;
  cacheFlush: WpCliStepResult;
  rewriteStructure: WpCliStepResult;
  rewriteFlush: WpCliStepResult;
  transientCleanup: WpCliStepResult;
  transientSqlCleanup: WpCliStepResult;
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
  envConfig?: EnvConfigResult;
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

/**
 * Files that must NEVER be deployed from local to WHC staging:
 * - wp-config.php: local DB credentials — would break WHC staging
 * - .env / .env.*: local secrets
 * - .htaccess: server-specific rewrite rules (regenerated post-deploy)
 * - wp-content/uploads/*: runtime content, WHC managed sync handles this
 * - wp-content/cache/*: local cache, not relevant on staging
 * - wp-content/upgrade/*: temporary upgrade files
 * - wp-content/debug.log: local debug output
 * - wp-content/object-cache.php: server-specific drop-in
 * - .git / .gitignore / .gitattributes: version control
 * - .whc: WHC local state
 * - node_modules: dependencies
 */
const SCP_SKIP_PATTERNS = [
  "wp-config.php",
  ".env",
  ".env.*",
  ".htaccess",
  "wp-content/uploads/*",
  "wp-content/cache/*",
  "wp-content/upgrade/*",
  "wp-content/debug.log",
  "wp-content/object-cache.php",
  ".git",
  ".gitignore",
  ".gitattributes",
  ".whc",
  "node_modules",
];

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

  const result: SftpUploadResult = await sshClient.sftpUploadDir(target, localDir, destPath, SCP_SKIP_PATTERNS);
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
 *
 * Ref: https://developer.wordpress.org/advanced-administration/upgrade/migrating/
 * Ref: https://developer.wordpress.org/cli/commands/search-replace/
 *
 * Official migration order:
 * 1. wp option update home <new-url>          — PRIMARY: set site URL
 * 2. wp option update siteurl <new-url>        — PRIMARY: set WordPress URL
 * 3. wp search-replace --dry-run               — safety preview
 * 4. wp search-replace --all-tables            — actual replace (skip guid + wp_users)
 * 5. wp cache flush                            — clear object cache
 * 6. wp rewrite structure <structure>          — re-save permalink structure
 * 7. wp rewrite flush                          — regenerate .htaccess rules
 * 8. wp transient delete --all                 — WP-CLI transient cleanup
 * 9. SQL DELETE transients                     — extra safety per official docs
 *
 * Note: GUID column MUST NOT be changed (WP official). wp_users table skipped.
 * Note: Transients are safe to delete — they auto-regenerate on demand.
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
      optionUpdateHome: { ...notConfigured, step: "option_update_home" },
      optionUpdateSiteurl: { ...notConfigured, step: "option_update_siteurl" },
      searchReplaceDryRun: { ...notConfigured, step: "search_replace_dry_run" },
      searchReplace: { ...notConfigured, step: "search_replace" },
      cacheFlush: { ...notConfigured, step: "cache_flush" },
      rewriteStructure: { ...notConfigured, step: "rewrite_structure" },
      rewriteFlush: { ...notConfigured, step: "rewrite_flush" },
      transientCleanup: { ...notConfigured, step: "transient_cleanup" },
      transientSqlCleanup: { ...notConfigured, step: "transient_sql_cleanup" },
    };
  }

  // Strip trailing slashes from URLs
  const oldNormalized = oldUrl.replace(/\/+$/, "");
  const newNormalized = newUrl.replace(/\/+$/, "");

  // ── Step 1: wp option update home (PRIMARY — official WP first step) ──
  const homeCmd = wpCmd(remotePath, `option update home '${newNormalized}' 2>&1`);
  const homeResult = await sshClient.execWithKey(target, homeCmd);
  const optionUpdateHome: WpCliStepResult = {
    ok: homeResult.ok,
    step: "option_update_home",
    message: homeResult.ok
      ? `home option set to ${newNormalized}.`
      : (homeResult.stderr || homeResult.message),
    stdout: homeResult.stdout,
  };

  // ── Step 2: wp option update siteurl (PRIMARY) ──
  const siteurlCmd = wpCmd(remotePath, `option update siteurl '${newNormalized}' 2>&1`);
  const siteurlResult = await sshClient.execWithKey(target, siteurlCmd);
  const optionUpdateSiteurl: WpCliStepResult = {
    ok: siteurlResult.ok,
    step: "option_update_siteurl",
    message: siteurlResult.ok
      ? `siteurl option set to ${newNormalized}.`
      : (siteurlResult.stderr || siteurlResult.message),
    stdout: siteurlResult.stdout,
  };

  // ── Step 3: Dry-run search-replace (safety check) ──
  const dryRunCmd = wpCmd(
    remotePath,
    `search-replace '${oldNormalized}' '${newNormalized}' --all-tables --skip-columns=guid --skip-tables=wp_users --dry-run --format=count 2>&1`,
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

  // ── Step 4: Actual search-replace ──
  const srCmd = wpCmd(
    remotePath,
    `search-replace '${oldNormalized}' '${newNormalized}' --all-tables --skip-columns=guid --skip-tables=wp_users --quiet --report-changed-only 2>&1`,
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

  // ── Step 5: Cache flush ──
  const cacheCmd = wpCmd(remotePath, `cache flush 2>&1`);
  const cacheResult = await sshClient.execWithKey(target, cacheCmd);
  const cacheFlush: WpCliStepResult = {
    ok: cacheResult.ok,
    step: "cache_flush",
    message: cacheResult.ok ? "Cache flushed." : (cacheResult.stderr || cacheResult.message),
    stdout: cacheResult.stdout,
  };

  // ── Step 6: Rewrite structure (re-save permalink) ──
  // Official WP docs: go to Settings > Permalinks and re-save
  const currentStructureCmd = wpCmd(remotePath, `option get permalink_structure 2>&1`);
  const structResult = await sshClient.execWithKey(target, currentStructureCmd);
  const permalinkStructure = structResult.ok ? structResult.stdout.trim() : "";
  let rewriteStructure: WpCliStepResult;

  if (permalinkStructure && permalinkStructure.length > 0) {
    const rwCmd = wpCmd(remotePath, `rewrite structure '${permalinkStructure.replace(/'/g, `'"'"'`)}' --quiet 2>&1`);
    const rwResult = await sshClient.execWithKey(target, rwCmd);
    rewriteStructure = {
      ok: rwResult.ok,
      step: "rewrite_structure",
      message: rwResult.ok ? `Permalink structure re-saved: ${permalinkStructure}` : (rwResult.stderr || rwResult.message),
      stdout: rwResult.stdout,
    };
  } else {
    // If no custom structure, just flush
    const rwCmd = wpCmd(remotePath, `rewrite flush --quiet 2>&1`);
    const rwResult = await sshClient.execWithKey(target, rwCmd);
    rewriteStructure = {
      ok: rwResult.ok,
      step: "rewrite_structure",
      message: rwResult.ok ? "Rewrite rules regenerated (default structure)." : (rwResult.stderr || rwResult.message),
      stdout: rwResult.stdout,
    };
  }

  // ── Step 7: Rewrite flush (regenerate .htaccess) ──
  const rewriteCmd = wpCmd(remotePath, `rewrite flush --quiet 2>&1`);
  const rewriteResult = await sshClient.execWithKey(target, rewriteCmd);
  const rewriteFlush: WpCliStepResult = {
    ok: rewriteResult.ok,
    step: "rewrite_flush",
    message: rewriteResult.ok ? "Rewrite rules flushed." : (rewriteResult.stderr || rewriteResult.message),
    stdout: rewriteResult.stdout,
  };

  // ── Step 8: WP-CLI transient delete ──
  const transientCmd = wpCmd(remotePath, `transient delete --all 2>&1`);
  const transientResult = await sshClient.execWithKey(target, transientCmd);
  const transientCleanup: WpCliStepResult = {
    ok: transientResult.ok,
    step: "transient_cleanup",
    message: transientResult.ok ? "Transients deleted (wp transient)." : (transientResult.stderr || transientResult.message),
    stdout: transientResult.stdout,
  };

  // ── Step 9: SQL-based transient cleanup (official WP recommendation) ──
  // Ref: https://developer.wordpress.org/advanced-administration/upgrade/migrating/
  // "Transients are temporary cached values... safe to delete them from the migrated database"
  // SQL: DELETE FROM wp_options WHERE option_name LIKE '%_transient_%'
  const transientSqlCmd = wpCmd(
    remotePath,
    `db query "DELETE FROM $(wp --path='${remotePath.replace(/'/g, `'"'"'`)}' config get table_prefix)options WHERE option_name LIKE '%\\\\_transient\\\\_%'" 2>&1`,
  );
  const transientSqlResult = await sshClient.execWithKey(target, transientSqlCmd);
  const transientSqlCleanup: WpCliStepResult = {
    ok: transientSqlResult.ok,
    step: "transient_sql_cleanup",
    message: transientSqlResult.ok
      ? "Transients deleted (SQL cleanup)."
      : (transientSqlResult.stderr || transientSqlResult.message),
    stdout: transientSqlResult.stdout,
  };

  const allOk =
    optionUpdateHome.ok &&
    optionUpdateSiteurl.ok &&
    searchReplaceDryRun.ok &&
    searchReplace.ok &&
    cacheFlush.ok &&
    rewriteStructure.ok &&
    rewriteFlush.ok &&
    transientCleanup.ok &&
    transientSqlCleanup.ok;

  return {
    ok: allOk,
    optionUpdateHome,
    optionUpdateSiteurl,
    searchReplaceDryRun,
    searchReplace,
    cacheFlush,
    rewriteStructure,
    rewriteFlush,
    transientCleanup,
    transientSqlCleanup,
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

// ── Phase 4c: Environment Config Bootstrap (WHC-specific) ──────────────────

export interface EnvConfigResult {
  ok: boolean;
  steps: WpCliStepResult[];
}

/**
 * Apply environment-specific WordPress configuration after deploy.
 * For WHC staging, this ensures safe defaults without touching DB credentials
 * (which are managed by WHC's staging clone, stored in wp-config.php).
 *
 * Safe wp config set operations:
 * - WP_DEBUG: false on staging (no public debug output)
 * - WP_DEBUG_LOG: true (log to file for troubleshooting)
 * - WP_DEBUG_DISPLAY: false (don't show errors on screen)
 * - WP_DISABLE_FATAL_ERROR_HANDLER: false
 * - WP_POST_REVISIONS: limit revisions on staging
 *
 * NOTE: We use `wp config set` which modifies wp-config.php directly.
 * This is safe because WHC staging has its own wp-config.php — we're
 * NOT overwriting it with the local version (SCP skip list prevents that).
 */
export async function runEnvConfigBootstrap(
  config: AppConfig,
  sshClient: WhcSshClient,
  environment: "live" | "staging",
): Promise<EnvConfigResult> {
  const target = resolveStagingTarget(config);
  const remotePath = resolveStagingPath(config);

  if (!target || !remotePath) {
    return {
      ok: false,
      steps: [{ ok: false, step: "env_config", message: "Staging target/path not configured." }],
    };
  }

  const steps: WpCliStepResult[] = [];
  const isProd = environment === "live";

  // Only apply these on staging (production should be configured manually)
  if (!isProd) {
    const envSettings: Array<{ key: string; value: string; raw: boolean }> = [
      { key: "WP_DEBUG", value: "false", raw: true },
      { key: "WP_DEBUG_LOG", value: "true", raw: true },
      { key: "WP_DEBUG_DISPLAY", value: "false", raw: true },
      { key: "WP_DISABLE_FATAL_ERROR_HANDLER", value: "false", raw: true },
    ];

    for (const setting of envSettings) {
      const rawFlag = setting.raw ? " --raw" : "";
      const cmd = wpCmd(remotePath, `config set ${setting.key} '${setting.value}'${rawFlag} 2>&1`);
      const result = await sshClient.execWithKey(target, cmd);
      steps.push({
        ok: result.ok,
        step: `config_set:${setting.key}`,
        message: result.ok
          ? `${setting.key} = ${setting.value}`
          : `${setting.key} failed: ${result.stderr || result.message}`,
        stdout: result.stdout,
      });
    }
  }

  // Check that WP_HOME matches the expected domain
  const expectedDomain = environment === "staging"
    ? config.domains.staging
    : config.domains.primary;

  if (expectedDomain) {
    const checkCmd = wpCmd(remotePath, `option get home 2>&1`);
    const checkResult = await sshClient.execWithKey(target, checkCmd);
    const currentHome = checkResult.ok ? checkResult.stdout.trim() : "";
    const expectedUrl = expectedDomain.startsWith("http")
      ? expectedDomain.replace(/\/+$/, "")
      : `https://${expectedDomain}`;

    if (currentHome !== expectedUrl) {
      steps.push({
        ok: false,
        step: "config_verify:WP_HOME",
        message: `WP_HOME mismatch: expected ${expectedUrl}, got ${currentHome}. Run DB migration first.`,
      });
    } else {
      steps.push({
        ok: true,
        step: "config_verify:WP_HOME",
        message: `WP_HOME verified: ${currentHome}`,
        stdout: currentHome,
      });
    }
  }

  return {
    ok: steps.every((s) => s.ok),
    steps,
  };
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

  // Phase 4c: Environment config bootstrap (WP_DEBUG, etc.)
  const envConfig = await runEnvConfigBootstrap(config, sshClient, input.smokeEnvironment ?? "staging");

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
    envConfig.ok &&
    (!seedBootstrap || seedBootstrap.ok) &&
    (!smokeGate || smokeGate.ok);

  return {
    ok: allOk,
    scpSync,
    wpCliBootstrap,
    dbMigration,
    envConfig,
    seedBootstrap,
    smokeGate,
    warnings,
  };
}
