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
1. Baseline mode: git_deploy (repository-driven deploy safety).
2. Code delivery mode for Mytho app artifacts: SSH/SCP file transfer + WP-CLI.

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
1. Use git_deploy only when repository-driven deployment is the real transport.
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
