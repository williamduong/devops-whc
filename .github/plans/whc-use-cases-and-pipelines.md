# WHC Use Cases and Pipelines

Status: active
Owner: devops-whc
Last updated: 2026-06-08

## 1) Purpose
Define the operational model of this tool server before further implementation.

This document answers:
1. Which user problems The tool server must solve.
2. Which deployment pipeline applies to each problem.
3. Which environment is the source of truth in each pipeline.
4. Which tools/actions are allowed at each step.
5. Which guardrails apply before state-changing operations.

## 2) System Model

## 2.0 Generic Orchestration Model
This tool server must model deployment problems in provider-agnostic terms before mapping them to WHC.

### Core abstractions
1. Project source
   - local root, app path, source kind, build strategy, deploy unit.
2. Target environment
   - live, staging, preview, or other named target with its own path mapping and capability profile.
3. State categories
   - code state, runtime state, content/data state, deployment state.
4. Release intent
   - refresh, deploy, promote, migrate, recover.
5. Delivery mechanism
   - provider sync, Git deployment, SSH execution, file transfer, or read-only probe.
6. Safety context
   - direction, scope, blast radius, data-loss risk, overwrite risk, and unmerged-work risk.

### Source shape rules
1. Do not assume a WordPress project is a full-site repository.
2. Support common source shapes:
   - full-site repository
   - partial content repository
   - theme or plugin package
   - artifact-first build output
   - monorepo app slice
3. Source classification must happen before pipeline selection.

## 2.1 WHC-Native Capability Map
This tool server must then map the generic model onto WHC according to what the platform actually provides.

### WHC native surfaces
1. Managed WordPress bootstrap
   - Initial site can start on a WHC testing domain like `wpXXXX.wpdns.ca`.
   - Primary domain is connected later via nameserver or A record update.
2. Managed WordPress staging
   - Available only on Managed WordPress plans that support staging.
   - Staging is created by copying Live.
   - Staging credentials differ from Live credentials.
   - Sync supports 3 scopes:
     - Everything
     - Files Only
     - Database Only
3. cPanel Git Version Control
   - Repository can be created or external repository can be cloned in cPanel.
   - Requires Shell Access enabled and authorized SSH public key.
4. SSH/SFTP and cPanel File Manager
   - Valid modification channels for code/files.
5. WordPress Admin + WHC Tools plugin
   - Used to access/manage Live and Staging from dashboard.

### WHC known constraints
1. Managed staging is not a generic isolated environment chain; it is clone-and-sync.
2. Managed staging currently does not support:
   - WordPress Multi-Site / Multi-network
   - Aliases or addon domains
   - `.htaccess` folder protection in staging (use Private Mode instead)
3. A staging-to-live sync can overwrite changes on target environment.
4. Automated database backup may be created under `/wp_deploy_backups` on the Live account after deployment issues.

### tool server design implication
1. Pipelines must be selected from the generic model first, then mapped to these native surfaces.
2. tool server orchestration is additive, not a replacement for WHC's managed staging semantics.
3. Git and WP-CLI are support layers around WHC, not proof that WHC behaves like Kubernetes-style CI/CD.

### 2.2 Environment roles
1. Local
   - Developer workspace.
   - Source of code changes.
2. Live
   - Public production environment on WHC.
   - Source used by WHC to create managed staging.
3. Staging
   - Safe validation environment.
   - In managed mode, cloned from Live.
4. Git remote
   - Code transport and history system.
   - Not automatically the operational source of truth for full WordPress state.

### 2.3 State categories
1. Code state
   - Theme, plugin, deployment scripts, tracked files.
2. Runtime state
   - PHP version, webroot, SSL, DNS, host paths.
3. Content/data state
   - Posts, orders, forms, users, uploads, options.
4. Deployment state
   - Git repo config, cPanel deployment status, sync timestamps.

## 3) Primary Workflow Modes

### Mode A: git_deploy
Use when:
1. WHC managed staging exists.
2. Release process depends on WHC Staging -> Live push.

Source-of-truth model:
1. Live is the source used to create staging.
2. Staging is the pre-release validation environment.
3. Push from staging updates Live.

Implication:
1. This is not a pure isolated CI chain.
2. Live initialization must happen first.
3. Pipeline should model WHC sync scopes: Everything, Files Only, Database Only.

### Mode B: ssh_scp (file transfer + WP-CLI)
Use when:
1. Deployment is driven by Git and cPanel Git Version Control.
2. Staging may be folder-based or repo-based.
3. Operator wants code-first deployment semantics.

Source-of-truth model:
1. Git is source of truth for code.
2. Runtime/content state may still differ from Git.
3. WordPress data is not fully represented in Git.

Implication:
1. Git deploy is valid for code promotion.
2. Data/content sync remains a separate concern.
3. This mode still depends on WHC/cPanel shell and repository support, not generic server assumptions.

## 4) Use Case Catalog

### UC1 - First-time WHC Live Initialization
Goal:
1. Bring initial Live site to a known-good baseline.

WHC-native mapping:
1. Managed WordPress may start on a testing domain before main domain cutover.
2. Domain connection is an explicit setup stage, not assumed complete.

Inputs:
1. Domain.
2. DNS/IP.
3. SSL status.
4. DB baseline.

Expected outputs:
1. Live readiness status.
2. Detected default WordPress or existing app.
3. Safe next recommendation.

Recommended tool/action path:
1. whc_check_health
2. capability scan
3. path discovery
4. WP-CLI basic checks

### UC2 - Create/Validate Managed Staging
Goal:
1. Ensure staging exists and is usable for testing.

WHC-native mapping:
1. Staging is created from Live using WHC staging dashboard.
2. Staging URL, admin access, SSH/SFTP, and environment comparison are managed by WHC.

Inputs:
1. WHC staging metadata.
2. Staging domain.
3. Staging SSH/SFTP access.

Expected outputs:
1. Staging readiness state.
2. Risk flags for dynamic-data sync.

### UC3 - Default WordPress Exists But Git Project Already Exists
Goal:
1. Adopt Git without destructive wipe of Live.

WHC-native mapping:
1. Default WordPress on Live is a normal WHC bootstrap state.
2. Managed staging is the safer adoption surface than immediate Live replacement.

Recommended decision:
1. Do not wipe Live by default.
2. Create/confirm staging.
3. Deploy Git code into staging.
4. Reconcile WordPress runtime/content state.
5. Validate.
6. Sync or deploy to Live.

Migration checklist:
1. Confirm `home` and `siteurl` values match the intended environment.
2. Confirm uploads and content dependencies needed by the Git code are present.
3. Classify the change as code-only or data-coupled.
4. Decide whether `wp search-replace --dry-run` is required before promotion.
5. Confirm plugin/theme/runtime dependencies match between Live and Staging.
6. Confirm cache/permalink rewrite actions needed after promotion.

Blocked default behavior:
1. No immediate deletion of default `public_html` contents.

### UC3A - Project Source Classification
Goal:
1. Normalize a local project into a deployable source profile before any delivery decision is made.

Inputs:
1. Local project root.
2. Optional app subpath.
3. Optional build command or artifact path.

Expected outputs:
1. Source kind classification.
2. Deploy unit classification.
3. Build-strategy requirement.
4. Recommended release intents.

### UC4 - Local Change Promotion
Goal:
1. Move a local code change toward production.

Variants:
1. Local -> Staging -> Live (managed mode)
2. Local -> Git -> cPanel deploy target (git mode)
3. Local -> Artifact -> target path (artifact-first source shape)

WHC-native mapping:
1. WHC natively supports Staging -> Live push in managed mode.
2. WHC natively supports repository creation/clone in cPanel Git Version Control.
3. tool server may combine these, but must not blur them into a fake single platform feature.
4. tool server must classify the local project source before choosing one of these variants.

### UC5 - Operations / Incident / Recovery
Goal:
1. Investigate failures and recover safely.

Actions:
1. logs
2. DB backup
3. health check
4. WP-CLI cache/plugin checks

### UC6 - WordPress App Maintenance
Goal:
1. Perform safe app-level tasks through WP-CLI.

WHC-native mapping:
1. WP-CLI is an SSH-era operational helper, not a WHC managed staging primitive.
2. It augments deployments and diagnostics where shell access exists.

Actions:
1. `wp core is-installed`
2. `wp option get home`
3. `wp plugin list`
4. `wp cache flush`
5. dry-run search-replace

## 5) Canonical Pipelines

### Pipeline P0 - Source Classification Pipeline
Purpose:
1. Normalize an arbitrary local project into a source profile that later pipelines can use safely.

Steps:
1. Resolve local root and optional app subpath.
2. Detect source kind.
3. Detect whether build output or raw source is the deploy unit.
4. Detect whether the project is full-site, partial-content, package-only, artifact-first, or monorepo app slice.
5. Emit normalized source profile and allowed release intents.

Entry criteria:
1. Local project path available.

Exit criteria:
1. Later pipelines can consume the source profile without assuming one project shape.

### Pipeline P1 - Live Baseline Pipeline
Purpose:
1. Establish whether Live is ready for staging and deployment.

WHC surface used:
1. Managed WordPress dashboard.
2. DNS/domain linkage.
3. SSH/SFTP/File Manager.
4. WP Admin.

Steps:
1. Resolve domain/DNS/SSL.
2. Resolve HOME and PROD_PATH.
3. Detect provider baseline app vs custom app.
4. Verify UAPI, SSH, and WP-CLI capability.
5. Emit next allowed actions.
6. Detect whether site is still running on testing domain or primary domain.

Entry criteria:
1. WHC account credentials available.

Exit criteria:
1. Live status categorized as `ready`, `needs_fix`, or `unknown`.

### Pipeline P2 - Managed Staging Promotion Pipeline
Purpose:
1. Release through WHC managed staging.

WHC surface used:
1. Managed WordPress Staging dashboard.
2. Staging URL/admin.
3. Sync direction and scope chooser.

Steps:
1. Confirm staging exists.
2. Confirm staging domain/SSH/WP-CLI.
3. Apply/test changes in staging.
4. Smoke test.
5. Choose sync scope:
   - Everything
   - Files Only
   - Database Only
6. Warn about dynamic data overwrite.
7. Explicit confirm.
8. Push staging to live.
9. Post-sync health check.

Entry criteria:
1. `workflow_mode = git_deploy`
2. Staging exists.

Exit criteria:
1. Live updated and verified.

### Pipeline P2R - Managed Staging Refresh Pipeline
Purpose:
1. Refresh staging from the current Live state before new testing begins.

WHC surface used:
1. Managed WordPress Staging dashboard.
2. Copy Live to Staging sync direction.

Steps:
1. Confirm staging exists.
2. Confirm operator intends to discard stale staging changes.
3. Choose sync scope:
   - Everything
   - Files Only
   - Database Only
4. Warn if target staging contains unmerged work.
5. Execute Copy Live to Staging.
6. Re-check staging health.

Entry criteria:
1. `workflow_mode = git_deploy`
2. Staging exists.

Exit criteria:
1. Staging reflects the latest approved Live baseline.

### Pipeline P3 - Git Deployment Pipeline
Purpose:
1. Deploy code through Git + cPanel deployment mechanisms.

WHC surface used:
1. cPanel Git Version Control.
2. Shell access.
3. Authorized SSH public key.

Steps:
1. Ensure repo is configured in cPanel.
2. Consume normalized source profile.
3. Validate deploy target path.
4. Git push / deployment trigger.
5. Optional WP-CLI post-deploy actions.
6. Health verification.

Entry criteria:
1. `workflow_mode = git_deploy`

Exit criteria:
1. Target code updated and runtime validated.

### Pipeline P3D - Deploy Decision Tree
Purpose:
1. Prevent `whc_deploy` from conflating WHC sync actions with cPanel Git deployment.

Decision rules:
1. Consume normalized source profile and explicit release intent first.
2. If `workflow_mode = git_deploy`:
   - `direction = live_to_staging` -> route to P2R semantics.
   - `direction = staging_to_live` -> route to P2 semantics.
   - require `sync_scope = files | database | everything`.
3. Note: git_controlled (cPanel Git UAPI) is not available on WHC Managed WordPress.
   - route to Git deployment semantics only.
   - do not model this as WHC staging synchronization.
4. If request mixes both intents:
   - reject as mode/action mismatch.

### Pipeline P4 - Default-WP to Git Migration Pipeline
Purpose:
1. Migrate from WHC default WordPress baseline to Git-managed code safely.

WHC surface used:
1. Managed WordPress initial site.
2. Managed staging clone.
3. SSH/SFTP or Git deployment into staging.

Steps:
1. Detect provider baseline app on Live.
2. Ensure backups exist.
3. Create/validate staging.
4. Consume normalized source profile.
5. Deploy code to staging first.
6. Validate app and WP behavior.
7. Promote from staging to live or switch to Git-controlled target.

Entry criteria:
1. Existing Git project.
2. Live contains default WP baseline.

Exit criteria:
1. Live no longer depends on manual default-WP baseline.

### Pipeline P5 - Recovery and Diagnostics Pipeline
Purpose:
1. Investigate and recover from failed deployments or broken sites.

WHC surface used:
1. Logs / SSH / File Manager.
2. Automated backup folder hints.
3. WP Admin and WP-CLI.

Steps:
1. Read health and logs.
2. Check WP-CLI availability.
3. Back up DB before risky remediation.
4. Run approved WP-CLI/SSH diagnostics.
5. Emit rollback or fix instructions.

## 6) Pipeline Decision Table

| Condition | Pipeline | Workflow mode |
| --- | --- | --- |
| Local project shape must be understood before any deploy | P0 | either |
| Managed WordPress still on testing domain/bootstrap stage | P1 | git_deploy |
| Live not yet baselined | P1 | git_deploy |
| Staging exists but is stale and must be refreshed from Live | P2R | git_deploy |
| Managed staging exists and release should use WHC sync | P2 | git_deploy |
| Git repo is configured and deployment is code-first | P3 | git_deploy (then SSH/SCP for code) |
| A deploy request must be routed by mode/direction | P3D | either |
| Default WP exists and Git project must take over | P4 | git_deploy refresh + SSH/SCP code delivery |
| Something failed and operator needs diagnosis/recovery | P5 | either |

## 7) Tool and Action Mapping

| Use case / pipeline | Main tool(s) | Supporting actions |
| --- | --- | --- |
| P0 Source classification | whc_setup_remote, whc_deploy | source kind detection, deploy-unit detection, build-strategy detection |
| P1 Live baseline | whc_check_health | capability probe, path discovery, domain/DNS state, WP-CLI probe |
| P2R Managed refresh | whc_deploy | refresh confirmation, scope selection, staging health re-check |
| P2 Managed promotion | whc_deploy | sync_scope selection, backup_db_before_sync, staging_smoke_test, post_sync_health_check |
| P3 Git deploy | whc_setup_remote, whc_deploy | cPanel repo create/clone, cpanel.yml generation, WP-CLI post-deploy |
| P3D Deploy decision | whc_deploy | workflow-mode routing, direction validation, scope validation |
| P4 Git migration | whc_setup_remote, whc_check_health | backup, staging validation, policy warnings, default-WP detection |
| P5 Recovery | whc_get_logs, whc_db_backup, whc_ssh_exec | WP-CLI diagnostics, health scan, restore hint from `wp_deploy_backups` |

## 8) WordPress-Specific Action Library

### Safe read actions
1. `wp core is-installed`
2. `wp option get home`
3. `wp option get siteurl`
4. `wp plugin list`
5. `wp theme list`
6. `wp user list --field=user_login`

### Safe maintenance actions
1. `wp cache flush`
2. `wp rewrite flush`
3. `wp plugin deactivate <plugin>` with confirmation
4. `wp plugin activate <plugin>` with confirmation

### High-risk actions
1. `wp search-replace`
2. plugin/theme update in production
3. DB-destructive or broad file mutations

Rule:
1. High-risk actions must be modeled as Level C or D depending on blast radius.

## 9) Guardrails by Pipeline
1. No pipeline may assume one project shape before source classification.
2. No pipeline may assume a full-site repository when the source may be partial-content or package-only.
3. No pipeline may assume staging folder naming.
4. No pipeline may delete Live content by default.
5. No pipeline may sync staging to live without dynamic-data warning.
6. No pipeline may refresh staging from Live without warning that unmerged staging work may be lost.
5. No pipeline may treat Git as source of truth for WordPress content state.
6. No pipeline may require SSH success for server startup.
7. No pipeline may claim WHC staging exists on plans that do not support Managed WordPress staging.
8. No pipeline may assume staging and live share the same SSH credentials.
9. No pipeline may assume `.htaccess`-based private protection works in managed staging; prefer WHC Private Mode.

## 9.1 Sync Scope Safety Matrix
| Sync scope | Direction | Baseline safety | Required guardrails |
| --- | --- | --- | --- |
| Files Only | Live -> Staging | C | warn if staging contains unmerged code work |
| Files Only | Staging -> Live | C | explicit confirm |
| Database Only | Live -> Staging | D | warn that staging DB edits will be lost |
| Database Only | Staging -> Live | D | explicit confirm + dynamic-data warning |
| Everything | Live -> Staging | D | explicit confirm + stale-staging overwrite warning |
| Everything | Staging -> Live | D | explicit confirm + dynamic-data warning |

## 10) tool server Output Requirements
Every relevant tool response should eventually expose:
1. `meta.workflow_mode`
2. `meta.pipeline_id`
3. `meta.release_intent`
4. `meta.delivery_mechanism`
5. `meta.source_profile`
6. `meta.capabilities.uapi`
7. `meta.capabilities.ssh.prod`
8. `meta.capabilities.ssh.staging`
9. `meta.capabilities.wpcli.prod`
10. `meta.capabilities.wpcli.staging`
11. `meta.paths.prod`
12. `meta.paths.staging`
13. `meta.warnings`

## 11) Implementation Order From This Model
1. Bind P0 source classification into `whc_setup_remote` and `whc_deploy` first.
2. Bind P1 to `whc_check_health`.
3. Bind P2/P3 policy selection into `whc_deploy`.
4. Bind P4 migration guidance into `whc_setup_remote` and `whc_check_health`.
5. Bind P5 into logs/backup/ssh exec with WP-CLI allowlist.

## 11.1 WHC-Specific Non-Goals
1. Do not model WHC as a generic multi-stage DevOps platform.
2. Do not assume root/server administration actions like firewall or fail2ban are available on Managed WordPress/shared cPanel accounts.
3. Do not assume Git deployment alone can fully represent WordPress content, uploads, or transactional data.

## 12) Done Criteria
This model is considered integrated only when:
1. Each MVP tool references one or more pipelines.
2. Each state-changing action names its workflow mode and pipeline.
3. WP-CLI actions are classified by safety level.
4. Recovery and migration paths are first-class documented outputs, not ad hoc advice.


