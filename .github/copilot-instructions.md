# Copilot Instructions for devops-whc

## Plan Index (Start Here)
Primary execution plan:
- `.github/plans/whc-mcp-build-plan.md`
Secondary operations plan:
- `.github/plans/whc-cicd-flow-sessions.md`
Use-case and pipeline plan:
- `.github/plans/whc-use-cases-and-pipelines.md`
Mytho deployment pipeline plan:
- `.github/plans/whc-mytho-deploy-pipeline.md`
DevOps verify standard:
- `.github/plans/whc-devops-verify-standard.md`
Tool contract spec v2:
- `.github/plans/whc-tool-contract-spec-v2.md`

Mandatory behavior:
1. Always consult the plan before implementing any new task.
2. Map each code change to a specific phase/task in the plan.
3. If implementation deviates from plan, update the plan first, then implement.
4. Prioritize work by the plan's execution order and quality gates.

## Mission
Build a production-oriented MCP server for WHC.ca (cPanel) that uses a provider-agnostic orchestration model to enable safe and repeatable Local -> Target workflows.

## Generic Orchestration Model (Must Follow)
Model deployments in generic domain terms first, then map them onto WHC capabilities.

Core abstractions:
1. Project source
	- local project root, app path, source kind, build strategy, deploy unit.
2. Target environment
	- live, staging, preview, or other named target with its own capabilities and paths.
3. State categories
	- code state, runtime state, content/data state, deployment state.
4. Release intent
	- refresh, deploy, promote, migrate, recover.
5. Delivery mechanism
	- provider sync, Git deployment, SSH execution, file transfer, or other supported mechanism.
6. Safety context
	- direction, scope, blast radius, data-loss risk, unmerged-work risk, and confirmation rules.

Generic rules:
1. Do not design contracts around any single local project shape.
2. Do not assume every WordPress project is a full-site repository.
3. Do not assume Git is always the delivery mechanism.
4. Classify project source and release intent before selecting a workflow mode.

## WHC Workflow Reality (Must Follow)
WHC Managed WordPress staging is a clone-and-sync model, not a classic isolated CI/CD environment chain.

Operational truth:
1. Initial staging is created from Live (Live -> Staging clone).
2. Ongoing deployment loop is Staging test -> Push Staging to Live.
3. For first-time setup with default WordPress on Live, do not force-delete by default; prefer controlled replacement via staging validation and push.

Design implication for this MCP:
1. Keep WHC as an adapter layer over the generic orchestration model.
2. Support both modes explicitly:
	- Managed WP Clone-and-Sync mode (WHC-native staging).
	- Git-controlled mode (cPanel Git + deployment steps).
3. Treat environment source-of-truth as policy-driven, not hardcoded.
4. Always expose which mode is active in tool responses (`meta.workflow_mode`).
5. Treat WHC sync and cPanel Git deployment as distinct capabilities, even when surfaced through one tool name.

Primary outcomes:
- Git automation with cPanel Git Version Control.
- Deployment trigger via UAPI VersionControl::deployment.
- SSH remote execution on port 27.
- Operational visibility (logs, health, SSL, disk/load checks).

## Product Scope (MVP)
Implement and stabilize these tools first:
1. whc_setup_remote
2. whc_deploy
3. whc_ssh_exec
4. whc_get_logs
5. whc_db_backup
6. whc_check_health

Do not add extra tools before MVP tools are fully tested.

## Tech and Runtime Standards
- Language: TypeScript on Node.js LTS.
- Protocol: MCP server using @modelcontextprotocol/sdk.
- API channel: cPanel UAPI over HTTPS (2083).
- SSH channel: port 27 only.
- Config source: local .env only (never hardcode secrets).

## Architecture Mindset (Operating System, not scripts)
Treat this project as an operations platform with strict contracts, not ad hoc command wrappers.

Required modules:
1. tool-registry: central metadata for tool name, mode, safety level, schema.
2. handlers: one handler per tool with narrow responsibilities.
3. schema-validator: runtime validation for all tool inputs.
4. source-inspector: normalize project source shape and deploy unit.
5. target-resolver: normalize target environment metadata and capability state.
6. delivery-planner: map release intent to workflow mode and mechanism.
7. whc-client: typed UAPI client with retry/backoff and timeout.
8. ssh-client: typed SSH executor with explicit port and safe command controls.
9. policy-engine: confirmation and block rules by contextual risk.
10. idempotency-store: deduplicate retried write operations.
11. audit-logger: append-only action trail for every write operation.

Keep handlers thin. Business logic belongs in service modules.

## Tool Contract Rules
Every tool must use a consistent request/response envelope.

Request envelope fields:
- request_id
- actor
- dry_run (optional)
- idempotency_key (required for writes)
- payload

Payload expectations for state-changing tools:
1. Include enough context to determine project source, target environment, release intent, and delivery mechanism.
2. Never force all callers into one repository layout assumption.

Response envelope fields:
- ok
- action_id
- tool
- data
- error
- meta (latency_ms, retry info, safety_level)

Response metadata expectations:
1. Expose generic execution context such as `meta.workflow_mode`, `meta.pipeline_id`, `meta.release_intent`, and `meta.delivery_mechanism`.
2. When possible, expose normalized source and target summaries rather than only provider-specific labels.

All write tools must be idempotent by key + normalized payload hash.

## Safety and Confirmation Policy
Use risk levels for every tool operation:

1. Level A (read-only)
- No confirmation.

2. Level B (low-risk write)
- Single confirmation if context is ambiguous.

3. Level C (state-changing write)
- Explicit confirmation required.

4. Level D (destructive or broad impact)
- Mandatory dry-run + explicit confirmation.

Rules:
- Any operation that can overwrite, delete, or impact multiple targets is Level D.
- Database backup is write-like and must be auditable.
- Never execute destructive SSH commands without policy approval.
- Any operation that can overwrite Live content from Staging or Git must require explicit environment confirmation.
- For dynamic WordPress sites, require an extra data-loss warning before staging-to-live sync.
- Risk evaluation must consider release direction, scope, target criticality, and data-loss potential, not only a static tool label.
- WHC sync scope must affect safety level:
	- Files Only: lowest sync risk, but still confirm when target is Live.
	- Database Only: elevated risk, especially for dynamic sites.
	- Everything: highest risk and always treated as destructive/broad-impact.

## Environment and Flow Rules
1. Source discovery is mandatory before first deploy:
	- Classify local project root, app path, source kind, build strategy, and deploy unit.
	- Do not assume a full-site repository, a theme-only repository, or a monorepo app slice without inspection.
2. Environment discovery is mandatory before first deploy:
	- Resolve HOME, PROD_PATH, and candidate STAGING_PATH.
	- Detect whether staging exists and whether it is WHC-managed or folder-based.
3. Do not assume `public_html/staging` exists.
4. If no staging is detected, guide operator to create WHC staging first (managed mode) or initialize folder-based staging (git mode).
5. If Live only has default WordPress and an external project exists, recommend:
	- create staging,
	- deploy code to staging,
	- reconcile WordPress runtime state,
	- validate,
	- then push/sync to live.
6. Any "wipe default live files" action is Level D and blocked unless explicit confirmation is provided.
7. Model both synchronization directions in managed mode:
	 - Copy Live to Staging
	 - Push Staging to Live

## Capability Gating
The MCP must start and operate even if SSH capability is unavailable.

Rules:
1. Compute capability state at startup: UAPI, SSH.
2. Read-only/UAPI tools remain available when SSH fails.
3. SSH-dependent tools return structured `BUSINESS_POLICY_BLOCKED` with remediation steps.
4. Never fail server startup solely because SSH auth is unavailable.

## Error Model and Reliability
Use normalized error codes:
- VALIDATION_ERROR
- AUTH_ERROR
- FORBIDDEN
- NOT_FOUND
- RATE_LIMITED
- TEMPORARY_UPSTREAM_ERROR
- BUSINESS_POLICY_BLOCKED
- UNKNOWN_UPSTREAM_ERROR

Reliability requirements:
- Retry with exponential backoff + jitter for 429/5xx where safe.
- Honor Retry-After when present.
- Use strict timeout for every network and SSH operation.
- Return actionable error messages with next-step hints.

## Security Rules (Non-Negotiable)
1. Never hardcode API tokens, SSH keys, passwords, or hostnames tied to secrets.
2. Secrets must come from .env and stay gitignored.
3. Redact tokens/keys from logs and error messages.
4. Prefer reusing existing CI/CD secrets and avoid requesting duplicate secrets unless required.
5. Validate host and protocol before outbound calls.

## Implementation Roadmap (Execution Order)
Canonical detailed roadmap lives in `.github/plans/whc-mcp-build-plan.md`.

Phase 1: Foundation and connectivity
1. Project skeleton and tool registry.
2. Env validation and typed config loader.
3. UAPI connectivity probe and SSH connectivity probe.

Phase 2: Deploy and Git automation
1. whc_setup_remote.
2. whc_deploy.
3. cpanel.yml template generator.

Phase 3: Monitoring and utility tools
1. whc_get_logs.
2. whc_db_backup.
3. whc_check_health.

Phase 4: Integration
1. Gemini CLI MCP registration notes.
2. High-level aliases/workflows (for example whc-sync-staging).

## Testing Strategy (Minimum)
For each tool add:
1. Input schema validation tests.
2. Success-path integration tests with mocked upstream.
3. Error-path tests for auth, rate limit, timeout, and invalid payload.
4. Policy tests for safety/confirmation behavior.

Before merge:
1. Typecheck passes.
2. Unit tests pass.
3. No secret leakage in logs/tests.
4. Tool contract snapshots are stable.

## Coding Conventions
1. Prefer small, composable functions and explicit types.
2. Avoid hidden side effects in handlers.
3. Keep network and parsing logic separate.
4. Add concise comments only for non-obvious logic.
5. Preserve backward compatibility for tool payloads once published.

## Definition of Done (per tool)
A tool is considered done only when:
1. Contract is documented and validated.
2. Safety level is assigned and enforced.
3. Idempotency and audit behavior are implemented for write paths.
4. Tests cover happy path and critical failures.
5. Logs are useful and secret-safe.