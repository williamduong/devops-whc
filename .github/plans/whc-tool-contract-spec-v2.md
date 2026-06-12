# WHC Tool Contract Spec V2

Status: implemented
Owner: devops-whc
Last updated: 2026-06-10

## 1) Purpose
Define and freeze the current tool contracts for safe DevOps operations on WHC.

This version reflects implementation state, not pre-implementation proposal.

## 2) Shared Envelope Rules
All tools use a common request envelope:
1. request_id
2. actor
3. dry_run (when relevant)
4. confirmed (write/high-risk)
5. idempotency_key (write tools)
6. payload

All tools return a common response envelope:
1. ok
2. action_id
3. tool
4. data
5. error
6. meta

Standard error codes:
1. VALIDATION_ERROR
2. AUTH_ERROR
3. FORBIDDEN
4. NOT_FOUND
5. RATE_LIMITED
6. TEMPORARY_UPSTREAM_ERROR
7. BUSINESS_POLICY_BLOCKED
8. UNKNOWN_UPSTREAM_ERROR

## 3) Tool System (Current)

### 3.1 Core flow tools
1. whc_prepare
2. whc_deploy
3. whc_verify

Default order:
1. whc_prepare -> whc_deploy -> whc_verify

### 3.2 Support tools
1. whc_pipeline_status
2. whc_check_health
3. whc_get_logs
4. whc_ssh_exec
5. whc_db_backup
6. whc_setup_remote
7. whc_rollback

## 4) Hidden State Namespace
Project-scoped hidden namespace:
1. .whc/state
2. .whc/state/releases
3. .whc/state/reports
4. .whc/logs
5. .whc/env

Rules:
1. State is repository-scoped.
2. .whc/ remains gitignored.
3. Namespace can be overridden with WHC_STATE_ROOT.

## 5) Tool Contracts

### 5.1 whc_prepare
Category:
1. mode: write
2. safety: B

Purpose:
1. Initialize hidden workspace state.
2. Ensure .whc/ ignore rule.
3. Run minimal credential readiness checks.

Notes:
1. Safe to run repeatedly.
2. Writes pipeline-status file when missing or reinitialize requested.

### 5.2 whc_verify
Category:
1. mode: read
2. safety: A

Purpose:
1. Run post-deploy technical verification.
2. Validate file/config/health and optional DB checks.
3. Write verify report to state reports directory.

Status model:
1. PASS
2. PARTIAL
3. FAIL

### 5.3 whc_pipeline_status
Category:
1. mode: read
2. safety: A

Purpose:
1. Read latest pipeline progress from state.
2. Return pointers to state, manifest, and flow-log artifacts.

### 5.4 whc_rollback
Category:
1. mode: write
2. safety: D

Purpose:
1. Execute guarded rollback strategies.

Supported modes:
1. git_branch
2. db_backup
3. managed_sync_reverse (manual action response)

Mandatory policy gates:
1. dry_run=true required by Level D policy for preview phase.
2. confirmed=true required by Level D policy for execution phase.
3. verify-chain PASS required before rollback is allowed.

Verify-chain requirement:
1. rollback must read a whc_verify report.
2. final_status must be PASS.
3. if verify_release_id is provided, report release_id must match.

## 6) Quality Gates (Current)
1. Tool-level schema validation tests exist for newly added tools.
2. Policy tests enforce Level D dry-run + confirmation behavior.
3. Full suite passes with rollback integration.
4. Build passes after contract wiring.

## 7) Operational Sequence
Recommended production-safe sequence:
1. whc_prepare
2. whc_deploy with dry_run
3. whc_deploy execution
4. whc_verify
5. whc_pipeline_status (optional visibility)
6. whc_rollback only if verify-chain PASS and rollback is explicitly approved

## 8) Security Constraints
1. No secret values in source or docs.
2. No secret leakage in logs.
3. Write operations are auditable via flow log.
