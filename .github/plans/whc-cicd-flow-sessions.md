# WHC CI/CD Flow Sessions Plan

Status: active
Owner: devops-whc
Last updated: 2026-06-08

## 1) Goal
Standardize a practical WHC delivery workflow for MCP operations across multiple WordPress project shapes and deployment styles:
1. Live initialization and domain cutover.
2. Managed staging clone-and-sync lifecycle.
3. Project onboarding and migration from provider baseline state.
4. Local -> Target delivery patterns.
5. WP-CLI operational automation where applicable.

## 2) Confirmed WHC Reality
1. Managed staging is created from Live first.
2. Ongoing release loop is Staging validation -> Push Staging to Live.
3. Production and staging can be separate SSH accounts/paths.
4. cPanel terminal access does not guarantee immediate local SSH key success.

## 2.1) Generic Delivery Abstractions for These Sessions
1. Project source must be classified before deployment.
	- full-site repo, partial content repo, theme/plugin package, artifact-first project, or monorepo app slice.
2. Release intent must be explicit.
	- refresh, deploy, promote, migrate, recover.
3. Delivery mechanism must be explicit.
	- WHC sync, Git deployment, SSH execution, or read-only probe.
4. WordPress-specific tasks are augmentations, not the base deployment model.

## 3) Session Breakdown

### Session A - Environment Canonicalization
Scope:
1. Confirm primary/testing/staging domains.
2. Confirm PROD_PATH and STAGING_PATH by SSH.
3. Confirm prod/staging SSH identities and host mapping.

Deliverables:
1. Canonical env map for prod and staging.
2. Capability snapshot (UAPI, SSH-prod, SSH-staging).

Acceptance:
1. Probe passes for UAPI and production SSH.
2. Staging SSH login path validated.

### Session B - Live Initialization Baseline
Scope:
1. Validate domain/DNS/SSL state for primary domain.
2. Detect default WordPress footprint on Live.
3. Validate DB baseline and backup readiness.

Deliverables:
1. Live-init checklist and remediation hints.
2. Non-destructive migration recommendation when default WP exists.

Acceptance:
1. MCP can report live baseline status in one response.

### Session C - Managed Staging Baseline
Scope:
1. Validate staging domain and service health.
2. Capture staging account path and key runtime facts.
3. Add data-loss risk signal for dynamic sites.
4. Model both sync directions, not only staging promotion.

Deliverables:
1. Staging readiness report.
2. Sync risk warning policy map.
3. Refresh-vs-promotion decision guide.

Acceptance:
1. MCP returns explicit push-to-live warning requirements.

### Session D - Project Onboarding and Migration Strategy
Scope:
1. Case: user already has an external project while WHC created a provider baseline app on Live.
2. Define safe migration path without immediate destructive wipe.
3. Support multiple project shapes, not only full-site repositories.

Recommended path:
1. Keep Live as baseline.
2. Create/confirm staging clone.
3. Classify project source and deploy unit.
4. Deploy code into staging using the selected mechanism.
5. Reconcile application runtime state.
6. Validate on staging.
7. Push staging to live.

Migration checklist:
1. Confirm `home` and `siteurl` values.
2. Confirm uploads/content dependencies are present.
3. Classify release as code-only or data-coupled.
4. Decide whether `wp search-replace` dry-run is required.
5. Confirm plugin/theme/runtime dependencies match expectations.
6. Confirm whether the source is full-site, partial-content, package-only, or artifact-first.

Deliverables:
1. Migration runbook in MCP responses.
2. Level D confirmation gates for destructive actions.

Acceptance:
1. No default-live wipe step occurs without explicit confirm.

### Session E - CI/CD Pattern Options
Scope:
1. Define supported release patterns and when to use each.

Pattern 1: Managed clone-sync
1. Local source classification -> refresh staging from live when needed -> deploy/update staging -> test -> push staging to live.
2. Use when WHC managed staging is the operational source for release.

Pattern 2: Git-controlled deployment
1. Local source classification -> Git push or artifact delivery -> cPanel deployment target.
2. Optional post-deploy WP-CLI steps.

Pattern selection rule:
1. If managed staging exists and sync is used, default to managed_clone_sync.
2. If staging is folder-based and deployment is Git-first, use git_controlled.

Deliverables:
1. MCP tool metadata includes active workflow mode.
2. Deploy handler enforces mode-specific rules.
3. `whc_deploy` decision tree documented by mode and sync direction.

Acceptance:
1. Wrong-mode deploy requests are blocked with corrective guidance.

### Session F - WP-CLI Integration Review
Scope:
1. Verify whether `wp` command is available on prod/staging SSH accounts.
2. Define safe WP-CLI actions for deployment lifecycle.

Target actions:
1. `wp core is-installed`
2. `wp option get home`
3. `wp plugin list`
4. `wp cache flush`
5. Controlled search-replace for URL migration (with dry-run first)

Deliverables:
1. WP-CLI capability flags.
2. Policy-safe WP-CLI command allowlist for MCP.

Acceptance:
1. MCP can report WP-CLI availability per environment.

## 4) CI/CD Action Catalog (WordPress-focused)
1. source_profile_classify
2. release_intent_resolve
3. preflight_env_validate
4. preflight_capability_scan
5. refresh_live_to_staging_confirmed
6. backup_db_before_sync
7. backup_files_before_sync
8. staging_deploy_code
9. staging_smoke_test
10. wpcli_cache_clear
11. wpcli_plugin_health_check
12. sync_staging_to_live_confirmed
13. post_sync_health_check
14. rollback_instructions_emit

## 4.1) Safety Matrix by WHC Sync Scope
| Sync scope | Typical use | Risk level | Notes |
| --- | --- | --- | --- |
| Files Only | Theme/plugin/code changes | C | Still confirm when target is Live |
| Database Only | Selected content/config data push | D | Dangerous for dynamic/live data |
| Everything | Full environment sync | D | Highest overwrite risk |

## 4.2) `whc_deploy` Decision Tree
1. Normalize source profile and release intent first.
2. If `workflow_mode = managed_clone_sync`:
	- direction `live_to_staging` -> model WHC Copy Live to Staging
	- direction `staging_to_live` -> model WHC Push Staging to Live
	- require sync scope selection: `files`, `database`, `everything`
	- preserve deploy-unit awareness from source classification
3. If `workflow_mode = git_controlled`:
	- use cPanel Git Version Control deployment path
	- allow full-site, partial-content, package-only, or artifact-first sources
	- do not pretend to invoke WHC managed staging sync semantics
4. If request mixes Git deploy intent with WHC sync intent:
	- block as invalid mode/action mismatch and return corrective guidance

## 5) Policy Rules for These Sessions
1. Any live overwrite path is Level D.
2. Dynamic data warning is mandatory for staging-to-live sync.
3. If SSH unavailable in any environment, return capability-blocked and continue with UAPI-only operations.
4. Secrets are never printed in tool outputs.

## 6) Implementation Sequence
1. Session A and B first.
2. Session C and D second.
3. Session E and F third.
4. Then bind actions to MCP tools progressively.

## 7) Done Criteria
1. The project documents and enforces WHC clone-and-sync reality.
2. The project supports prod/staging split SSH metadata.
3. The project provides migration guidance for provider-baseline-to-project adoption across multiple project shapes.
4. The project defines CI/CD actions and WP-CLI checks with safety controls.