#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { loadConfig } from "./config/env";
import { dispatch } from "./dispatcher/tool-dispatcher";
import { executeWhcCheckHealth, buildDefaultWhcCheckHealthRequest } from "./handlers/whc-check-health";
import { runConnectivityProbe } from "./probes/connectivity";
import { validateWhcCheckHealthRequest } from "./schemas/whc-check-health";
import { TOOL_REGISTRY } from "./registry/tool-registry";
import { InMemoryIdempotencyStore } from "./idempotency/store";
import { ConsoleAuditLogger } from "./audit/audit-logger";
import { ToolResponseEnvelope } from "./contracts/envelope";
import { startWhcToolServer } from "./server";
import { runSourceCompatibilityCheck } from "./probes/source-compatibility";
import { ensureWorkspaceBootstrap } from "./state/workspace-state";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";

const HELP_TEXT = [
  `WHC CLI Help v${APP_VERSION}`,
  "",
  "Modes:",
  "  --serve         Start stdio tool server (registers all tools)",
  "  --probe         Run connectivity probe (UAPI, SSH, WP-CLI)",
  "  --check-generic Run one-shot deploy readiness check for a specific project folder",
  "  --check-health  Execute whc_check_health once and print JSON",
  "  --version       Print CLI version",
  "  --help          Show this help",
  "",
  "Quick start:",
  "  1) npm install",
  "  2) copy .env.example to .env and fill secrets",
  "  3) npm run prepare",
  "  4) npm run serve",
  "",
  "Published package use:",
  "  npx -y devops-whc --serve",
  "  npx -y devops-whc --probe",
  "  npx -y devops-whc --check-generic --project-root D:/Source/mytho/source/wordpress --workflow-mode ssh_scp_wpcli",
  "  npx -y devops-whc --check-health",
  "",
  "Safe release flow:",
  "  1) check-health",
  "  2) pre-deploy logs",
  "  3) staging deploy dry-run (confirmed=true if policy requires)",
  "  4) staging deploy real",
  "  5) smoke gate",
  "  6) promote live only when smoke is green",
  "",
  "Git deploy payload reminders:",
  "  - direction is required: live_to_staging or staging_to_live",
  "  - sync_scope is required for clear safety intent",
  "  - staging_to_live + database/everything needs backup policy",
  "",
  "ssh_scp_wpcli reminders:",
  "  - check-generic validates mytho/source-style doctor prerequisites",
  "  - whc_deploy currently returns guidance/dry-run only for this mode",
  "",
  "Flow log:",
  "  - default: .whc/logs/flow-events.jsonl",
  "  - override: set WHC_FLOW_LOG_PATH",
  "",
  "Secrets safety:",
  "  - do not commit .env or .vscode/whc.env",
  "  - npm tarball excludes local env files by design",
  "",
  "Reference:",
  "  - AGENT_USAGE.md",
].join("\n");

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(HELP_TEXT);
    return;
  }

  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log(APP_VERSION);
    return;
  }

  // Stdio server mode — all tools registered, reads from stdin/stdout
  if (process.argv.includes("--serve")) {
    await startWhcToolServer();
    return;
  }

  if (process.argv.includes("--probe")) {
    const config = loadConfig();
    const report = await runConnectivityProbe(config);
    const stagingWpCliOk = report.wpcli.staging.reachable;
    console.log(
      JSON.stringify(
        {
          ok: report.uapi.ok && report.ssh.ok && report.wpcli.prod.reachable && stagingWpCliOk,
          action_id: randomUUID(),
          tool: "whc_connectivity_probe",
          data: report,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (process.argv.includes("--check-generic")) {
    const projectRootArg = readCliOption("--project-root");
    if (!projectRootArg) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            ready_for_deploy: false,
            status: "blocked",
            next_actions: [
              "Re-run with --project-root <folder> so WHC can bootstrap hidden state for that specific project.",
            ],
            action_id: randomUUID(),
            tool: "whc_source_compatibility_check",
            data: {
              ok: false,
              ready_for_deploy: false,
              status: "blocked",
              blockers: ["Missing required CLI argument: --project-root"],
              warnings: [],
              next_actions: [
                "Use --project-root <folder> to tell WHC which deploy workspace to initialize and check.",
              ],
              checks: [
                {
                  id: "project-root-argument",
                  status: "fail",
                  message: "Project root folder was not provided.",
                  hint: "Example: npx -y devops-whc --check-generic --project-root D:/Source/mytho/source/wordpress --workflow-mode ssh_scp_wpcli",
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const projectRoot = path.resolve(projectRootArg);
    const appPathArg = readCliOption("--app-path");
    const effectiveAppPath = appPathArg ?? ".";
    const appRoot = path.resolve(projectRoot, effectiveAppPath);
    if (!existsSync(appRoot)) {
      console.log(
        JSON.stringify(
          {
            ok: false,
            ready_for_deploy: false,
            status: "blocked",
            next_actions: [
              "Fix --app-path so it points to an existing application directory, then rerun check-generic.",
            ],
            action_id: randomUUID(),
            tool: "whc_source_compatibility_check",
            data: {
              ok: false,
              ready_for_deploy: false,
              status: "blocked",
              paths: {
                local_project_root: projectRoot,
                app_root: appRoot,
                wp_content_path: path.resolve(appRoot, "wp-content"),
              },
              blockers: [`Application path does not exist: ${appRoot}`],
              warnings: [],
              next_actions: [
                "Fix --app-path so it points to an existing application directory, then rerun check-generic.",
              ],
              checks: [
                {
                  id: "app-root",
                  status: "fail",
                  message: "Application root path is missing.",
                  details: appRoot,
                  hint: "User must point WHC at the correct project-root/app-path. Hidden WHC files are not initialized until the effective app root is valid.",
                },
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const bootstrap = ensureWorkspaceBootstrap(appRoot, {
      localProjectRoot: projectRoot,
      localAppPath: appPathArg,
    });
    const projectEnv = readProjectEnv(bootstrap.envFile);
    const mergedEnv: NodeJS.ProcessEnv = {
      ...withoutWhcEnv(process.env),
      ...projectEnv,
      WHC_LOCAL_PROJECT_ROOT: projectRoot,
    };
    if (appPathArg) {
      mergedEnv.WHC_LOCAL_APP_PATH = appPathArg;
    } else {
      mergedEnv.WHC_LOCAL_APP_PATH = "";
    }
    const workflowModeArg = readCliOption("--workflow-mode");
    if (workflowModeArg) {
      mergedEnv.WHC_WORKFLOW_MODE = workflowModeArg;
    }

    let config;
    try {
      config = loadConfig(mergedEnv);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown config error";
      const missingKeys = extractMissingEnvKeys(message);
      console.log(
        JSON.stringify(
          {
            ok: false,
            ready_for_deploy: false,
            status: "blocked",
            next_actions: [
              `Fill the missing credentials in ${bootstrap.envFile}.`,
              "Re-run check-generic after updating the project-local WHC env file.",
            ],
            action_id: randomUUID(),
            tool: "whc_source_compatibility_check",
            data: {
              ok: false,
              ready_for_deploy: false,
              status: "blocked",
              paths: {
                local_project_root: projectRoot,
                app_root: appRoot,
                wp_content_path: path.resolve(appRoot, "wp-content"),
              },
              bootstrap: {
                state_root: bootstrap.stateRootRelative,
                created_paths: bootstrap.createdPaths,
                pipeline_status_file: bootstrap.pipelineStatusFile,
                env_file: bootstrap.envFile,
                env_example_file: bootstrap.envExampleFile,
                gitignore_updated: bootstrap.gitignoreUpdated,
              },
              summary: {
                pass: 1,
                warn: 0,
                fail: missingKeys.length,
              },
              blockers: missingKeys.map((key) => `Set ${key} in ${bootstrap.envFile}`),
              warnings: [],
              next_actions: [
                `Fill the missing credentials in ${bootstrap.envFile}.`,
                "Re-run check-generic after updating the project-local WHC env file.",
              ],
              checks: [
                {
                  id: "workspace-bootstrap",
                  status: "pass",
                  message: "App-specific WHC hidden files are initialized.",
                  details: bootstrap.stateRootAbsolute,
                },
                ...missingKeys.map((key) => ({
                  id: `env:${key}`,
                  status: "fail" as const,
                  message: `${key} is missing for this project workspace.`,
                  hint: `Fill ${key} in ${bootstrap.envFile}`,
                })),
              ],
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const report = await runSourceCompatibilityCheck(config);
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          ready_for_deploy: report.ready_for_deploy,
          status: report.status,
          next_actions: report.next_actions,
          action_id: randomUUID(),
          tool: "whc_source_compatibility_check",
          data: {
            ...report,
            bootstrap: {
              state_root: bootstrap.stateRootRelative,
              created_paths: bootstrap.createdPaths,
              pipeline_status_file: bootstrap.pipelineStatusFile,
              env_file: bootstrap.envFile,
              env_example_file: bootstrap.envExampleFile,
              gitignore_updated: bootstrap.gitignoreUpdated,
            },
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (process.argv.includes("--check-health")) {
    const config = loadConfig();
    const request = buildDefaultWhcCheckHealthRequest(config);
    const toolDef = TOOL_REGISTRY["whc_check_health"];
    const result: ToolResponseEnvelope<unknown> = await dispatch({
      config,
      toolDef,
      rawInput: request,
      validate: validateWhcCheckHealthRequest,
      execute: (cfg, req) => executeWhcCheckHealth(cfg, req),
      idempotencyStore: new InMemoryIdempotencyStore(),
      auditLogger: new ConsoleAuditLogger(),
      actionIdFactory: randomUUID,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(HELP_TEXT);
}

function readCliOption(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    const normalized = flag.replace(/^--/, "").replace(/-/g, "_");
    const npmConfigValue = process.env[`npm_config_${normalized}`];
    if (npmConfigValue && npmConfigValue.length > 0) {
      return npmConfigValue;
    }
    return readCheckGenericPositional(flag);
  }
  return process.argv[index + 1];
}

function readProjectEnv(filePath: string): NodeJS.ProcessEnv {
  if (!existsSync(filePath)) {
    return {};
  }
  const parsed = dotenv.parse(readFileSync(filePath, "utf8"));
  return parsed as NodeJS.ProcessEnv;
}

function extractMissingEnvKeys(message: string): string[] {
  const prefix = "VALIDATION_ERROR: Missing or invalid env vars:";
  if (!message.startsWith(prefix)) {
    return ["project-specific WHC env values"];
  }
  return message
    .slice(prefix.length)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function withoutWhcEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("WHC_")),
  ) as NodeJS.ProcessEnv;
}

function readCheckGenericPositional(flag: string): string | undefined {
  const checkIndex = process.argv.indexOf("--check-generic");
  if (checkIndex === -1) {
    return undefined;
  }
  const trailing = process.argv.slice(checkIndex + 1);
  const positionalMap: Record<string, number> = {
    "--project-root": 0,
    "--app-path": 1,
    "--workflow-mode": 2,
  };
  const position = positionalMap[flag];
  if (position === undefined) {
    return undefined;
  }
  const value = trailing[position];
  return value && !value.startsWith("--") ? value : undefined;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(message);
  process.exitCode = 1;
});
