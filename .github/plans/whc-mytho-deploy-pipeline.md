# WHC Mytho Deploy Pipeline

Status: active
Owner: devops-whc
Last updated: 2026-06-10

## 1) Purpose
Define one complete, repeatable deploy pipeline for Mytho on WHC staging/live with explicit phase boundaries.

For generic DevOps verification format (manifest/report/pass-fail), see:
1. `.github/plans/whc-devops-verify-standard.md`

This document removes ambiguity between:
1. Code sync completion.
2. Runtime readiness.
3. Database and content readiness.
4. External smoke readiness.

A deployment is only FULL PASS when all required phases pass.

## 2) Source Profile (Mytho)
1. Local root: D:/Source/mytho/source
2. App path: wordpress
3. Source kind: full_site
4. Deploy unit: raw_source
5. Critical deploy artifacts:
   - wordpress/wp-content/plugins/mytho-core
   - wordpress/wp-content/themes/mytho-child

## 3) Pipeline Modes
1. Baseline mode: managed_clone_sync (environment refresh and promotion safety).
2. Code delivery mode for Mytho app artifacts: ssh/file transfer or git_controlled when policy allows.

Operational rule:
1. Managed sync does not automatically guarantee Mytho runtime or data completeness.
2. Runtime/data phases are mandatory for FULL PASS.

## 4) Phase Contract

### Phase 0 - Preflight and Backup
Goal:
1. Confirm remote operability and create rollback point.

Required checks:
1. SSH reachable.
2. PHP and WP-CLI available.
3. WP core installed.
4. Database backup artifact exists.

Required artifacts:
1. SSH probe output.
2. WP-CLI info output.
3. Backup path and file size.

Fail conditions:
1. No backup artifact.
2. WP-CLI unavailable.

### Phase 1 - Environment Baseline
Goal:
1. Ensure staging baseline is known and safe before app updates.

Allowed implementations:
1. managed_clone_sync refresh from live when needed.
2. Baseline validation only when staging already aligned and recent.

Required artifacts:
1. Sync action id or baseline validation output.

Fail conditions:
1. Unknown baseline state.

### Phase 2 - Code Deployment
Goal:
1. Deliver Mytho code artifacts to staging target paths.

Required actions:
1. Sync mytho-core plugin directory.
2. Sync mytho-child theme directory.

Required artifacts:
1. Remote file existence check for:
   - wp-content/plugins/mytho-core/mytho-core.php
   - wp-content/themes/mytho-child/style.css

Fail conditions:
1. Any required artifact missing.

### Phase 3 - Runtime Bootstrap
Goal:
1. Make WordPress runtime execute Mytho code correctly.

Required actions:
1. Activate plugin mytho-core.
2. Install and activate WooCommerce if missing.
3. Ensure child-theme parent exists.
4. Activate mytho-child theme.
5. Flush rewrite rules.

Required artifacts:
1. wp plugin list showing mytho-core active and woocommerce active.
2. wp theme list showing mytho-child active.

Fail conditions:
1. Required plugin/theme inactive.

### Phase 4 - Data and Content Bootstrap
Goal:
1. Ensure required Woo and Mytho pages/options exist in DB.

Required actions:
1. Ensure and publish pages: shop, cart, checkout, my-account.
2. Map Woo options:
   - woocommerce_shop_page_id
   - woocommerce_cart_page_id
   - woocommerce_checkout_page_id
   - woocommerce_myaccount_page_id

Required artifacts:
1. Option values for all four Woo page options.
2. Page list output proving publish status.

Fail conditions:
1. Any required page missing/unpublished.

### Phase 5 - Technical Smoke
Goal:
1. Validate external technical behavior.

Required probes:
1. Theme static artifact URL returns 200.
2. WP REST root returns 200.
3. Core commerce pages return 200: my-account, cart, checkout, shop.

Required artifacts:
1. URL to status-code table.

Fail conditions:
1. Any required URL not 200.

### Phase 6 - Business/API Smoke
Goal:
1. Confirm Mytho API surface is reachable with expected auth behavior.

Required probes:
1. Mytho protected admin endpoint returns 401 (or 200 with valid auth).

Required artifacts:
1. Endpoint to status-code result.

Fail conditions:
1. Endpoint unreachable or unexpected response class.

### Phase 7 - Gate and Report
Goal:
1. Produce deterministic final status.

Status rules:
1. FULL PASS: phases 0-6 all pass.
2. PASS PARTIAL: one or more required phases skipped or failed.
3. FAIL: blocking phase failed and rollout cannot be trusted.

Report minimum fields:
1. Per-phase status: PASS or FAIL.
2. Reason per phase.
3. Artifact per phase.
4. Backup reference.
5. Execution timestamp.

## 5) Validation Notes From Staging Run (2026-06-09)
Observed outcomes:
1. Phase 0 PASS
   - Backup created: /home/stag290886/wp_deploy_backups/staging-20260609-070844.sql.gz (238KB).
2. Phase 2 PASS
   - Required plugin/theme files exist on staging.
3. Phase 3 PASS
   - mytho-core active, woocommerce active, mytho-child active.
4. Phase 4 PASS
   - Woo page options set and pages published.
5. Phase 5 PASS
   - style.css 200, wp-json 200, my-account/cart/checkout/shop all 200.
6. Phase 6 PASS
   - /?rest_route=/mytho/v1/customers/1/classification returned 401 (expected protected endpoint behavior).

## 5.1 Data-Seed Completion Notes (2026-06-10)
Reason:
1. Staging initially looked different from local because technical pipeline passed while sample data bootstrap had not been applied.

Actions performed:
1. Pre-seed backup created.
2. Executed source-controlled script: `wordpress/scripts/seed-local-sample-data.php`.

Verified outcomes:
1. Seed output reported:
   - Categories: 6
   - Products: 8
   - Sample users: 4
   - Sample orders: 2
   - Segments: 18
2. Post-seed checks on staging:
   - Product count: 8
   - Product category count: 7 (includes default category in addition to seeded categories)
   - Shop order count: 2
   - Sample users present: 0900000001, 0900000002, 0900000003, 0900000004
3. External probes:
   - `/` -> 200
   - `/shop/` -> 200
   - `/my-account/` -> 200
   - `/?rest_route=/mytho/v1/customers/1/classification` -> 401 (expected auth gate)

## 5.2 MCP Response Contract Update (whc_deploy)
To make pipeline scope explicit, `whc_deploy` responses now include:
1. `data.pipeline_status`
   - `full_pass` or `pass_partial`
2. `data.phase_coverage`
   - `code_state` = included|excluded
   - `runtime_state` = included|excluded
   - `data_state` = included|excluded
   - `deployment_state` = included|excluded
   - `notes` = human-readable scope notes

Interpretation rule:
1. If any required state category is `excluded`, deployment must be treated as `pass_partial`.
2. Only when all four categories are `included` can `full_pass` be reported.

## 6) Anti-Confusion Rules
1. Do not claim deploy PASS when only code sync is done.
2. Do not use direct plugin PHP URL as plugin-health check.
3. Always distinguish code state, runtime state, data state, and deployment state.
4. If any runtime/data phase is skipped, final status must be PASS PARTIAL, not FULL PASS.

## 6.1 Setup-Remote Clarification
1. `whc_setup_remote` only sets up remote Git repository wiring on cPanel.
2. It does not move local source code by itself.
3. Required follow-up is always:
   - local `git push` to the returned `ssh_remote_hint`
   - then `whc_deploy`

## 6.2 Pipeline Tracking Signals
Use these fields to track run progress consistently:
1. `action_id` (event identity)
2. `data.pipeline_status` (`full_pass` | `pass_partial`)
3. `data.phase_coverage` (code/runtime/data/deployment inclusion)
4. `data.process_tracking` (stage, status, next_step, manual_actions) where provided
5. `.mcp/whc-mcp/logs/flow-events.jsonl` for chronological history

## 7) Suggested Operator Checklist
1. Run Phase 0 and capture backup reference.
2. Complete phases 1-4 before external URL probes.
3. Execute phases 5-6 and record status table.
4. Publish phase-by-phase report with artifacts.
5. Approve promotion only when FULL PASS.
