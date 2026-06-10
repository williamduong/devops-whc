#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/env";
import { dispatch } from "./dispatcher/tool-dispatcher";
import { executeWhcCheckHealth, buildDefaultWhcCheckHealthRequest } from "./handlers/whc-check-health";
import { runConnectivityProbe } from "./probes/connectivity";
import { validateWhcCheckHealthRequest } from "./schemas/whc-check-health";
import { TOOL_REGISTRY } from "./registry/tool-registry";
import { InMemoryIdempotencyStore } from "./idempotency/store";
import { ConsoleAuditLogger } from "./audit/audit-logger";
import { ToolResponseEnvelope } from "./contracts/envelope";
import { startMcpServer } from "./server";

const packageJson = require("../package.json") as { version: string };
const APP_VERSION = packageJson.version;

const HELP_TEXT = [
  `WHC MCP CLI Help v${APP_VERSION}`,
  "",
  "Modes:",
  "  --serve         Start MCP stdio server (registers all tools)",
  "  --probe         Run connectivity probe (UAPI, SSH, WP-CLI)",
  "  --check-health  Execute whc_check_health once and print JSON",
  "  --version       Print CLI version",
  "  --help          Show this help",
  "",
  "Quick start:",
  "  1) npm install",
  "  2) copy .env.example to .env and fill secrets",
  "  3) npm run mcp:prepare",
  "  4) npm run serve",
  "",
  "Published package use:",
  "  npx -y devops-whc --serve",
  "  npx -y devops-whc --probe",
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
  "Managed clone/sync payload reminders:",
  "  - direction is required: live_to_staging or staging_to_live",
  "  - sync_scope is required for clear safety intent",
  "  - staging_to_live + database/everything needs backup policy",
  "",
  "Flow log:",
  "  - default: .mcp/whc-mcp/logs/flow-events.jsonl",
  "  - override: set WHC_FLOW_LOG_PATH",
  "",
  "Secrets safety:",
  "  - do not commit .env or .vscode/whc.env",
  "  - npm tarball excludes local env files by design",
  "",
  "Reference:",
  "  - AGENT_MCP_USAGE.md",
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

  // MCP stdio server mode — all 6 tools registered, reads from stdin/stdout
  if (process.argv.includes("--serve")) {
    await startMcpServer();
    return;
  }

  const config = loadConfig();

  if (process.argv.includes("--probe")) {
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

  if (process.argv.includes("--check-health")) {
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(message);
  process.exitCode = 1;
});
