import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "../config/env";

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

export function runSourceCompatibilityCheck(config: AppConfig): SourceCompatibilityReport {
  const checks: SourceCompatibilityCheck[] = [];

  const localProjectRoot = path.resolve(config.sourceProfile.localProjectRoot ?? process.cwd());
  const appRoot = path.resolve(localProjectRoot, config.sourceProfile.localAppPath ?? ".");
  const wpContentPath = resolveWpContentPath(appRoot);
  const buildArtifactPath = config.sourceProfile.buildArtifactPath
    ? path.resolve(localProjectRoot, config.sourceProfile.buildArtifactPath)
    : undefined;

  checks.push({
    id: "workflow-mode",
    status: config.workflowMode === "managed_clone_sync" ? "pass" : "fail",
    message:
      config.workflowMode === "managed_clone_sync"
        ? "Pipeline mode is compatible."
        : "Pipeline mode is not compatible.",
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
  checks.push({
    id: "deploy-unit-alignment",
    status: deployUnit === recommendedUnit ? "pass" : "warn",
    message:
      deployUnit === recommendedUnit
        ? "Configured deploy unit aligns with source layout."
        : "Configured deploy unit should be adjusted for current layout.",
    details: `Recommended deploy unit is ${recommendedUnit}.`,
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
