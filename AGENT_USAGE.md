# WHC CLI Agent Usage Guide

This guide is for AI agents and operators who need predictable, safe usage of the WHC tool server.

## 1. Goal

Use WHC CLI to run a safe release flow:

1. Initialize workspace state (`whc_prepare`).
2. Validate connectivity and environment.
3. Deploy to staging first.
4. Run technical verify (`whc_verify`) and smoke gate.
5. Promote to live only if staging passes.

## 2. Runtime Model

The server supports two workflow modes:

1. `git_deploy`
2. `ssh_scp_wpcli`

`git_deploy` means local source is pushed to a cPanel-managed Git repository and deployment is triggered from that repository.
`ssh_scp_wpcli` means source-first delivery over SSH/SCP with runtime bootstrap via WP-CLI and smoke gating.
If `WHC_WORKFLOW_MODE` is omitted, default to `ssh_scp_wpcli`.

## 2.2 Tool Server Registration Standard

Use one of these two registration patterns and keep them consistent with README.

Published package (`npx`) recommended for most users:

```jsonc
{
  "servers": {
    "whc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "devops-whc", "--serve"],
      "env": {
        "WHC_ENV_FILE": "${workspaceFolder}/.env",
        "WHC_LOCAL_PROJECT_ROOT": "${workspaceFolder}",
        "WHC_STATE_ROOT": ".whc",
        "WHC_INSTANCE_NAME": "whc"
      }
    }
  }
}
```

Local clone (`start-whc.cjs`) for contributors:

```jsonc
{
  "servers": {
    "whc": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/start-whc.cjs"],
      "cwd": "${workspaceFolder}",
      "env": {
        "WHC_ENV_FILE": "${workspaceFolder}/.env",
        "WHC_LOCAL_PROJECT_ROOT": "${workspaceFolder}",
        "WHC_STATE_ROOT": ".whc",
        "WHC_INSTANCE_NAME": "whc"
      }
    }
  }
}
```

Quick CLI checks:

```powershell
npx -y devops-whc --help
npx -y devops-whc --version
npx -y devops-whc --probe
```

## 2.3 Publish Package Boundary

Release artifacts are published from `packages/devops-whc`, not from repository root.

Release commands:

```powershell
npm run pack:check
npm run publish:npm
```

`npm run pack:check` will run publish preparation and package dry-run against the subpackage.
`npm run publish:npm` runs `npm publish` from the publish subpackage.
For prerelease versions, `npm run publish:npm` automatically adds `--tag next` unless an explicit tag is provided.

## 2.1 Why `whc_setup_remote` Exists

`whc_setup_remote` does not deploy application code.

It only prepares the remote Git endpoint on cPanel (repository root + SSH hint) so local source can be pushed.

Think of it as wiring transport, not shipping release.

After `whc_setup_remote`, a manual or automated `git push` from local source is still required.

Current boundary:

1. `whc_setup_remote` is ready for remote Git repository setup.
2. `check:generic` is the main trustworthy readiness gate for both workflow modes.
3. `whc_deploy` for `git_deploy` triggers the real cPanel deployment task for a given `repository_root` and optional `branch`.
4. `whc_deploy` for `ssh_scp_wpcli` executes end-to-end: SCP sync → WP-CLI bootstrap → DB migration (search-replace + cache flush + rewrite flush + transient cleanup) → seed → smoke gate.

## 3. Required Context Before Any Write

Always collect these first:

1. Active workflow mode.
2. Target environment (`staging` or `live`).
3. For `git_deploy`, identify the remote repository root and branch that should be deployed.
4. For `ssh_scp_wpcli`, identify the local app root, staging SSH target, and runtime bootstrap path.
5. Whether `dry_run` and `confirmed` are required by policy.

## 3.1 Manual vs Agent Responsibilities

User/operator must do manually (once per environment):
1. Create/rotate WHC API token and place in env (`WHC_API_TOKEN`).
2. Add SSH public key to correct cPanel account.
3. Confirm host/path ownership and account scope.

Agent can automate repeatedly:
1. Validate context and run dry-run checks.
2. Create/list repository via `whc_setup_remote`.
3. Push local source to the cPanel-managed Git repository when credentials are available.
4. Trigger deployment via `whc_deploy` for the intended `repository_root` and optional `branch`.
5. Execute safe runtime probes and logs/health collection.
6. Run source-compatibility checks and hidden-state bootstrap for a specific project root.

Hybrid step:
1. `git push` may be run by agent from local terminal when keys/permissions are ready; otherwise operator performs push manually.

## 4. Safety Rules

1. Never claim a deploy was executed unless the handler actually changed remote state.
2. Never promote live directly without staging verification.
3. Prefer `dry_run=true` before state-changing requests.
4. Always set `confirmed=true` when the policy requires explicit confirmation.

## 5. Tool Order (Recommended)

1. `whc_prepare` to initialize hidden state and readiness checks.
2. `whc_check_health` for target status and capability baseline.
3. `whc_get_logs` for pre-deploy signal.
4. For `git_deploy`, run remote repository setup and local `git push`.
5. For `ssh_scp_wpcli`, run the project-local doctor/SCP/WP-CLI pipeline.
6. `whc_verify` to produce technical verify report.
7. Run smoke checks outside or via allowed tool path.
8. If staging passes, decide whether live release should proceed.

For `ssh_scp_wpcli` projects, replace steps 4-7 with the project-local source pipeline:
1. doctor
2. backup
3. SCP code sync
4. WP-CLI runtime bootstrap
5. seed/bootstrap
6. smoke gate

## 6.4 Rollback (Level D) Contract

Use rollback only when verify and policy conditions are satisfied.

Mandatory gates:
1. `dry_run=true` for preview.
2. `confirmed=true` for execution.
3. Verify-chain report from `whc_verify` with `final_status=PASS`.

Example rollback preview payload:

```json
{
  "dry_run": true,
  "confirmed": true,
  "payload": {
    "target_environment": "live",
    "rollback_mode": "git_branch",
    "rollback_branch": "rollback/main",
    "reason": "production incident mitigation",
    "verify_release_id": "rel-2026-06-10-01"
  }
}
```

## 6. Canonical Usage Patterns

### 6.1 `git_deploy`

Use this mode when the real delivery path is:

1. local Git repository
2. push to cPanel-managed repository
3. cPanel deployment task runs `.cpanel.yml`

Agent expectations today:

1. validate readiness with `check:generic`
2. ensure remote repo exists with `whc_setup_remote`
3. push with local Git
4. trigger the cPanel deployment task with `whc_deploy`
5. do not overstate this as WordPress runtime bootstrap; that still belongs to separate checks/scripts

### 6.2 `ssh_scp_wpcli`

Use this mode for `mytho/source` style delivery:

1. doctor
2. backup
3. SCP code sync
4. WP-CLI bootstrap
5. seed/bootstrap
6. smoke gate

## 7. Smoke Gate Expectations

Before live promote, ensure AC-critical smoke is green on staging.

Suggested minimum:

1. Account page reachable.
2. Required API namespace/routes reachable.
3. Pricing visibility behavior by auth state.
4. Checkout fee messaging baseline.

If preconditions fail (plugin/page/routes absent), gate must be `HOLD`.

## 7.1 Pipeline Mindset Guard

Treat these as two different foundations:

1. `git_deploy`
   - repository-driven
   - local `git push`
   - cPanel deployment task
   - `.cpanel.yml` at repo root
2. `ssh_scp_wpcli`
   - source-driven
   - SCP file transfer
   - remote WP-CLI runtime/bootstrap
   - project-specific smoke gate

Policy note:

1. `ssh_scp_wpcli` is the correct default mindset for `mytho/source`.
2. `git_deploy` should not be described as staging/live native sync.
3. If a release note or operator guide mentions `managed_clone_sync`, treat that as stale wording and replace it.

## 8. Troubleshooting

### 8.1 Startup auth errors with SSH key path

Symptom:

1. `AUTH_ERROR` or `ENOENT` for key file while path appears valid.

Checks:

1. Confirm `WHC_ENV_FILE` points to the intended env file.
2. Confirm The tool server process has reloaded after env edits.
3. Avoid malformed quoting in key path values.

### 8.2 Deploy contract confusion

If users are mixing repository deploy with environment-sync wording:

1. for `git_deploy`, think `repository_root`, `branch`, `.cpanel.yml`, and cPanel deployment task
2. for `ssh_scp_wpcli`, think WordPress app root, `scp`, `wp`, and smoke checks
3. do not describe either mode as native WHC staging/live clone sync

## 9. One-Line Operator Playbook

1. Health check -> logs -> staging dry-run -> staging deploy -> smoke gate -> decide promote/hold.

## 10. Flow Log Read Guide (For Agent Responses)

### 10.1 Log path

1. Default path: `.whc/logs/flow-events.jsonl`
2. Custom path (optional): set `WHC_FLOW_LOG_PATH` in env

### 10.2 Read latest entries (PowerShell)

```powershell
Get-Content .whc/logs/flow-events.jsonl -Tail 20
```

If custom path is configured:

```powershell
Get-Content $env:WHC_FLOW_LOG_PATH -Tail 20
```

Filter only deploy events:

```powershell
Get-Content .whc/logs/flow-events.jsonl -Tail 200 |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.tool -eq 'whc_deploy' } |
  Select-Object -Last 10
```

### 10.3 Response format requirement

When responding after any write tool run, agent should include:

1. `action_id`
2. `tool`
3. `status` (`success` or `failure`)
4. `request_id` (if available)
5. `pipeline_id`
6. `target_environment`
7. `release_intent`
8. Log path used

Minimal response snippet:

```text
Flow log:
- path: .whc/logs/flow-events.jsonl
- action_id: <value>
- tool: whc_deploy
- status: success|failure
- request_id: <value>
- pipeline_id: <value>
- target_environment: staging|live
- release_intent: deploy|refresh|promote|migrate|recover
```

## 10.4 First-Time Prepare (No Manual Template Filling)

For local clone workflows, run once per workspace:

```powershell
npm run prepare
```

For npm-package workflows, call `whc_prepare` once from The tool server client after the server starts.

This initializes hidden management paths automatically:
1. `.whc/state/pipeline-status.json`
2. `.whc/state/releases/`
3. `.whc/state/reports/`
4. `.whc/logs/`

It also ensures `.whc/` is ignored by git.

## 10.5 Automatic State Tracking

For every write tool run, tool server now auto-updates:
1. `.whc/state/pipeline-status.json` (started/completed/status/next step/error)
2. `.whc/state/releases/<request_id>.auto-manifest.json` (tool metadata + git changed files snapshot)

No manual template authoring is required for normal DevOps runs.

## 11. Pipeline Progress Tracking (What To Read)

For `whc_deploy` and `whc_setup_remote`, read these response fields first:
1. `data.pipeline_status`
  - `full_pass` or `pass_partial`
2. `data.phase_coverage`
  - `code_state`, `runtime_state`, `data_state`, `deployment_state`
3. `data.process_tracking` (setup_remote)
  - `stage`, `status`, `next_step`, `manual_actions`

Decision rule:
1. If `pipeline_status=pass_partial`, do not claim end-to-end release completion.
2. Follow `next_step` and unresolved `manual_actions` before moving to next gate.



