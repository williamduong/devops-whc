# WHC MCP Build Plan (Detailed)

Status: active
Owner: devops-whc
Last updated: 2026-06-10

## 1) Delivery Objective
Ship a production-ready MCP server for WHC cPanel operations with a generic orchestration core, a WHC adapter layer, safe Local -> Target workflows, and strong operational guardrails.

Success criteria:
1. All 6 MVP tools implemented and tested.
2. Extended tools (`whc_prepare`, `whc_verify`, `whc_pipeline_status`, `whc_rollback`) implemented and tested.
3. Safety policy enforced at runtime for every tool call.
4. Stable typed contracts for request/response envelopes.
5. No secret leakage in source, tests, logs, or errors.
6. Basic integration guide for Gemini CLI documented.

## 2) Scope Baseline
In scope (MVP):
1. whc_setup_remote
2. whc_deploy
3. whc_ssh_exec
4. whc_get_logs
5. whc_db_backup
6. whc_check_health
Ship a production-ready MCP server for WHC cPanel operations with safe Local -> Staging -> Production workflows and strong operational guardrails.
Out of scope (post-MVP):
1. Advanced dashboard UI.
2. Fully automated managed sync reverse rollback.
3. Multi-tenant policy inheritance.

## 2.1) WHC Environment Semantics (Critical)
1. WHC Managed WordPress staging is created from Live first.
2. Deployment lifecycle is clone/sync oriented, not strict isolated CI pipeline.
3. The MCP must support both workflow modes:
   - managed_clone_sync: Live -> Staging clone, Staging -> Live push.
   - git_controlled: Git repository deploy to target path via cPanel/SSH.
4. Tool outputs must include workflow mode and target environment metadata.

## 2.2) Generic Deployment Abstractions (Critical)
All implementation work must use these abstractions before provider-specific mapping:
1. Project source
   - root path, source kind, app path, build strategy, deploy unit.
2. Target environment
   - named environment, path mapping, capability profile, mutable data profile.
3. Release intent
   - refresh, deploy, promote, migrate, recover.
4. Delivery mechanism
   - provider sync, Git deployment, SSH execution, file transfer, or health/read-only probe.
5. Safety context
   - direction, scope, blast radius, data-loss risk, overwrite risk, and dry-run capability.

Rules:
1. Do not encode any single project layout as the default source shape.
2. Do not assume a WordPress project is always a full-site repository.
3. Do not let provider terminology replace the generic model in tool contracts.

## 3) Execution Principles
1. Contract-first: schema and envelope finalized before business logic.
2. Safety-first: risky operations blocked until confirm/dry-run policy passes.
3. Idempotent writes: every write path must support deterministic retries.
4. Observability-by-default: action logging and traceable error context.
5. Incremental release: phase gates with explicit acceptance criteria.
6. Capability-gated runtime: no SSH means degraded mode, not server failure.
7. Environment-truth before action: resolve actual home/staging/prod paths before deploy.

## 4) Work Breakdown Structure (WBS)

### Phase 0 - Project Bootstrap
Deliverables:
1. TypeScript Node.js MCP skeleton.
2. Source layout and module boundaries.
3. Initial scripts: build, test, typecheck, lint.

Tasks:
1. Initialize package and tsconfig.
2. Create module folders: registry, handlers, clients, policies, schemas, infra.
3. Add baseline test framework and coverage output.

Exit criteria:
1. `npm run build` passes.
2. `npm run test` executes baseline tests.
8. Domain-first before provider mapping: resolve source/intent/target in generic terms, then bind to WHC APIs or SSH.
3. `npm run typecheck` is clean.

### Phase 1 - Contracts, Config, and Connectivity
Deliverables:
1. Request/response envelope types.
2. Shared error taxonomy.
3. Typed config loader from `.env`.
4. UAPI and SSH connectivity probes.
5. Workflow mode and capability descriptors.
6. Source profile and target profile model types.

Tasks:
1. Define `ToolRequestEnvelope`, `ToolResponseEnvelope`, `ToolError`.
2. Implement config schema validation (required env fields).
3. Implement UAPI client auth header strategy.
4. Implement SSH client bootstrap on port 27.
5. Add probe commands and structured probe results.
6. Add startup capability state (`uapi_available`, `ssh_available`).
7. Add workflow mode enum (`managed_clone_sync`, `git_controlled`).
8. Define normalized source-profile and target-profile types for later handlers.

Exit criteria:
1. Missing env produces deterministic `VALIDATION_ERROR`.
2. UAPI probe returns normalized success/error payload.
3. SSH probe returns normalized success/error payload.
4. Server can run in degraded mode when SSH is unavailable.

### Phase 2 - Control Plane (Registry, Policy, Idempotency, Audit)
Deliverables:
1. Tool registry metadata for all MVP tools.
2. Safety policy engine (A/B/C/D).
3. Idempotency store interface and implementation.
4. Audit logger for write operations.
5. Environment source-of-truth policy resolver.
6. Release-intent resolver and delivery planner.

8. Add generic source model in config/contracts (not tied to one project shape).
Tasks:
1. Register each tool with mode and safety level.
2. Encode confirm/dry-run rules by safety level and contextual risk.
3. Persist idempotency key + payload hash + action_id.
4. Log all write attempts and outcomes.
5. Encode live-overwrite warning policy for staging-to-live sync.
6. Encode dynamic-data warning policy for WordPress sync.
7. Resolve project source + release intent before provider-specific execution.

Exit criteria:
1. Level D operations blocked without dry-run + confirm.
2. Duplicate write requests return prior action result.
3. Every write action has an audit trail entry.
4. Staging-to-live actions require explicit environment confirmation.
5. Deploy handler inputs can be normalized without assuming a single project shape.

### Phase 3 - Tool Implementation (Core)
Deliverables:
1. Functional handlers for each MVP tool.
2. JSON schemas for input validation.
3. Consistent response envelope implementation.
4. Environment discovery helper (HOME, PROD_PATH, STAGING_PATH candidates).
5. Source classification helper for local project inputs.

Tasks by tool:
1. whc_setup_remote
   - Create repo via cPanel Git features.
   - Return SSH remote URL and setup hints.
   - Detect existing baseline app state and return safe migration guidance.
2. whc_deploy
   - Normalize project source, release intent, and target mapping.
   - Invoke the correct delivery mechanism for the chosen workflow mode.
   - Validate source/target mapping, branch or artifact target, and direction/scope where applicable.
   - Apply workflow-mode-specific rules (`managed_clone_sync` vs `git_controlled`).
3. whc_ssh_exec
   - Execute safe command set via SSH.
   - Block denied command patterns by policy.
4. whc_get_logs
   - Fetch latest logs by app name and line count.
5. whc_db_backup
   - Trigger compressed SQL dump with audit metadata.
6. whc_check_health
   - Collect disk usage, SSL expiry, and server load.
   - Report capability state, discovered environment paths, and target metadata.

Exit criteria:
1. All tools return normalized envelope.
2. Safety policy invoked before every execution.
3. Tool-specific schemas reject invalid payloads.
4. Each tool response includes active workflow mode metadata.
   - Resolve deployment through generic release intent before invoking WHC adapter logic.

### Phase 4 - Reliability Hardening
Deliverables:
1. Retry/backoff middleware.
2. Timeout and cancellation handling.
3. Error normalization layer.

Tasks:
1. Add 429/5xx retry with jitter for safe operations.
2. Respect `Retry-After` where available.
3. Normalize upstream/network/auth failures to internal error codes.

Exit criteria:
1. Transient faults become retryable errors with hints.
2. Non-retryable faults fail fast with clear messages.

5. Each state-changing tool response includes resolved release intent and safety context.
### Phase 5 - Testing Matrix and Quality Gates
Deliverables:
1. Unit tests by module.
2. Contract tests for envelopes and schemas.
3. Handler integration tests with mocked UAPI/SSH.
4. Security checks for secret redaction.

Test matrix minimum:
1. Valid payload success case.
2. Invalid payload validation case.
3. Auth failure case.
4. Rate limit case.
5. Timeout case.
6. Policy blocked case.
7. Idempotent replay case.

Exit criteria:
1. Coverage target met for core modules.
2. All gates pass in CI.

### Phase 6 - Integration and Operational Readiness
Deliverables:
1. Gemini CLI registration note.
2. Example high-level workflows (for example `whc-sync-staging`).
3. Runbook for common failure recovery.

Tasks:
1. Document MCP server registration and required env.
2. Provide sample command flows for staging/prod deploy.
3. Provide troubleshooting quick-reference.

Exit criteria:
1. Operator can perform end-to-end staging deploy.
2. Operator can diagnose and recover from common failures.

## 5) Detailed Backlog by Module

### A. schemas/
1. envelope schemas
2. tool payload schemas
3. error response schema

### B. registry/
1. registry types
2. static metadata map
3. runtime lookup helpers

### C. policies/
1. safety-level evaluator
2. command denylist/allowlist (SSH)
3. confirmation requirement resolver

### D. clients/
1. UAPI client
2. SSH client
3. health probes client layer

### E. handlers/
1. one file per tool
2. common preflight (schema + policy + idempotency)
3. common postflight (audit + envelope)

### F. planners/
1. source classifier
2. release intent resolver
3. delivery mechanism planner

### G. infra/
1. logger with redaction
2. idempotency persistence
3. clock and UUID utilities

## 6) Risk Register and Mitigations
1. Risk: Unknown UAPI response shape variation.
   Mitigation: response normalizer + tolerant parser + contract tests.
2. Risk: SSH command abuse via generic executor.
   Mitigation: policy gate + denied pattern blocks + Level D enforcement.
3. Risk: secret exposure in error stack/logs.
   Mitigation: central redaction layer and log snapshot tests.
4. Risk: non-deterministic retries causing duplicate write actions.
   Mitigation: strict idempotency key policy.
5. Risk: environment drift between staging and production.
   Mitigation: explicit env mapping and deployment prechecks.
6. Risk: operator assumes staging-first CI model incompatible with WHC managed staging reality.
   Mitigation: mode-aware guidance and explicit source-of-truth policy in tool responses.
7. Risk: accidental overwrite of dynamic production data during staging push.
   Mitigation: mandatory warning/confirm gate for sync-to-live actions.
8. Risk: project source shape is misclassified and wrong files are deployed.
   Mitigation: explicit source classification, deploy-unit validation, and response metadata that explains the chosen source profile.

## 7) Milestones and Quality Gates
1. M1: Bootstrap complete (Phase 0-1).
2. M2: Control plane complete (Phase 2).
3. M3: Core tools complete (Phase 3).
4. M4: Reliability + test hardening complete (Phase 4-5).
5. M5: Integration runbook complete (Phase 6).

Release gate checklist:
1. All MVP tools pass contract and policy tests.
2. No critical security findings.
3. End-to-end staging deploy succeeds in dry-run and real-run mode.
4. Audit logs are complete and queryable.

## 8) Definition of Ready (DoR)
Before starting any tool implementation:
1. Tool schema drafted and reviewed.
2. Safety level assigned.
3. Expected upstream dependencies identified.
4. Test cases listed.
5. Workflow mode behavior defined for the tool.

## 9) Definition of Done (DoD)
A task is done only when:
1. Code merged with passing tests/typecheck/lint.
2. Policy and error behavior verified.
3. Idempotency/audit logic verified for write paths.
4. Docs updated with usage and failure modes.
5. Managed staging and git-controlled mode behavior documented and tested where applicable.

## 10) Execution Order (Short Form)
1. Contracts and config.
2. Control plane.
3. Implement tools in this order:
   - whc_check_health
   - whc_setup_remote
   - whc_deploy
   - whc_get_logs
   - whc_ssh_exec
   - whc_db_backup
   - whc_prepare
   - whc_verify
   - whc_pipeline_status
   - whc_rollback
4. Reliability hardening.
5. Test hardening.
6. Integration/runbook.

## 11) Reporting Cadence
For each implementation cycle, report:
1. Completed items.
2. Failed tests and fixes.
3. Risks introduced or retired.
4. Next top 3 tasks.

## 12) Execution Checkpoints

### Checkpoint 2026-06-08 (Phase 0-1 bootstrap)
Completed:
1. Project initialized with Node.js + TypeScript + Vitest + ESLint.
2. Source skeleton created for contracts, config, registry, policy, clients, probes, idempotency, and audit.
3. Env validation implemented with fail-fast behavior.
4. Connectivity probe flow implemented for UAPI and SSH.
5. Baseline tests added for env validation, policy behavior, and tool registry.
6. Quality gates passing: typecheck, test, lint, build.

Risks introduced:
1. SSH probe currently assumes private-key file path availability and does not yet support alternative auth fallback.

Next top 3 tasks:
1. Implement control plane orchestration wrapper (preflight schema + policy + idempotency + audit).
2. Add schema definitions for first real tool payloads (`whc_check_health`, `whc_setup_remote`).
3. Start Phase 3 with `whc_check_health` as first production handler.