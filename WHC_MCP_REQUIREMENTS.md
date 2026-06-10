# WHC.ca (cPanel) MCP Server Requirements

## 1. Objective
Build a specialized MCP (Model Context Protocol) Server to automate the management and deployment of web projects hosted on Web Hosting Canada (WHC.ca). The goal is to facilitate a seamless **Local -> Staging -> Production** workflow directly from the terminal/Gemini CLI.

## 2. Core Features
- **Git Automation:** Remote repository creation and branch-based synchronization.
- **API Deployment:** Triggering cPanel's native deployment engine via UAPI.
- **SSH Command Execution:** Remote server management (file manipulation, DB tasks) using WHC's specific port (27).
- **Status Monitoring:** Real-time health checks, log retrieval, and SSL status.

## 3. Tool Definitions (Current)

| Tool Name | Mode | Safety | Description |
| :--- | :--- | :--- | :--- |
| `whc_prepare` | write | B | Initializes hidden state namespace and readiness checks. |
| `whc_deploy` | write | C/D | Triggers deployment/sync flow with policy gating. |
| `whc_verify` | read | A | Runs technical post-deploy verification and writes verify report. |
| `whc_pipeline_status` | read | A | Reads latest pipeline state and artifact pointers. |
| `whc_rollback` | write | D | Guarded rollback (dry-run + confirm + verify-chain PASS required). |
| `whc_setup_remote` | write | C | Creates cPanel Git repo and returns SSH remote hints. |
| `whc_ssh_exec` | write | C | Executes policy-controlled SSH commands. |
| `whc_get_logs` | read | A | Fetches server logs. |
| `whc_db_backup` | write | D | Creates remote SQL backup with audit trail. |
| `whc_check_health` | read | A | Collects disk, SSL, load, and capability signals. |

### 3.4 Rollback Contract (Current)
`whc_rollback` is implemented as Level D.

Policy requirements:
1. `dry_run=true` is mandatory for preview phase.
2. `confirmed=true` is mandatory for execution phase.
3. Verify-chain must be present and PASS from `whc_verify` report.

Execution modes:
1. `git_branch` (UAPI deployment trigger with rollback branch)
2. `db_backup` (SSH `wp db import`)
3. `managed_sync_reverse` (manual action response with explicit warning)

## 3.1 Deploy Contract (Current)
`whc_deploy` now reports phase coverage explicitly to prevent false-positive "deploy pass" outcomes.

Response fields in `data`:
1. `pipeline_status`
    - `full_pass` | `pass_partial`
2. `phase_coverage`
    - `code_state`: `included` | `excluded`
    - `runtime_state`: `included` | `excluded`
    - `data_state`: `included` | `excluded`
    - `deployment_state`: `included` | `excluded`
    - `notes`: explanatory list for what is in/out of scope

Interpretation:
1. `pass_partial` is expected when a run covers only transport/sync/deploy mechanics.
2. `full_pass` must only be used when code/runtime/data/deployment states are all included and validated.

## 3.2 Setup-Remote Contract (Current)
`whc_setup_remote` is transport preparation, not code deployment.

Response fields in `data`:
1. `pipeline_status`
    - expected default: `pass_partial`
2. `phase_coverage`
    - deployment state reflects repository wiring only
3. `process_tracking`
    - `stage`: `setup_remote`
    - `status`: `completed` | `needs_manual_input`
    - `next_step`: actionable follow-up
    - `manual_actions`: explicit operator/agent to-do list

Operational implication:
1. A successful `whc_setup_remote` still requires local source push (`git push`) and subsequent `whc_deploy`.

## 3.3 Manual Prerequisites (Must Be Explicit)
These steps are not auto-solvable by MCP and must be prepared by operator:
1. WHC API token creation and placement in env.
2. SSH key provisioning to correct cPanel account.
3. Credential scope alignment (target path ownership/account).

## 4. Technical Stack
- **Language:** TypeScript / Node.js.
- **Framework:** MCP SDK (@modelcontextprotocol/sdk).
- **Communication:** 
    - **cPanel UAPI:** Over HTTPS (Port 2083) using API Tokens.
    - **SSH:** Using `ssh2` or system SSH (Port 27).
- **Configuration:** Global `.env` for sensitive credentials.

## 5. Implementation Roadmap

### Phase 1: Foundation & Auth
- [ ] Initialize MCP project.
- [ ] Implement secure `.env` loading for `WHC_API_TOKEN`, `WHC_USER`, and `WHC_HOST`.
- [ ] Test connectivity to cPanel API and SSH.

### Phase 2: Deployment & Git
- [ ] Build `whc_setup_remote`: Automate the "Git Version Control" setup in cPanel.
- [ ] Build `whc_deploy`: Connect to the `deployment` UAPI endpoint.
- [ ] Create a standard `.cpanel.yml` template generator.

### Phase 3: Monitoring & Utilities
- [ ] Implement remote log tailing via SSH.
- [ ] Implement database backup/restore helpers.
- [ ] Add health check dashboard.

### Phase 4: Gemini CLI Integration
- [ ] Register the MCP server in `gemini-config.json`.
- [ ] Create high-level commands/aliases (e.g., `whc-sync-staging`).

## 6. Security Protocol
- No API tokens or Private Keys are to be hardcoded.
- All sensitive data must reside in a local `.env` file excluded from git.
- API requests must use HTTPS with proper header authentication.
