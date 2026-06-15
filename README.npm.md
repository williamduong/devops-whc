# devops-whc

WHC cPanel automation CLI for deploy, verify, rollback, logs, backup, and health flows.

## Getting Started

Install globally:

```powershell
npm install -g devops-whc
whc --help
```

Or run directly with `npx`:

```powershell
npx -y devops-whc --help
```

## What This Package Is For

Use `devops-whc` when you need a local CLI / stdio server for WHC cPanel workflows such as:

1. deploy readiness checks
2. health and connectivity checks
3. repository-driven cPanel Git deployment
4. source-driven WordPress delivery with SSH/SCP/WP-CLI
5. database migration with WordPress-standard search-replace, cache flush, and transient cleanup
6. WooCommerce-ready staging deployment with safe environment config

## Two Workflow Modes

### `ssh_scp_wpcli`

Default mode. Full pipeline for `mytho/source` style delivery:

| Phase | Action | Details |
|---|---|---|
| 1. Doctor | Pre-flight checks | SSH, WP-CLI, remote path, HTTP probe |
| 2. Backup | DB export | `wp db export` → `.sql.gz` with audit trail |
| 3. SCP Sync | Code delivery | SFTP upload (auto-skips `wp-config.php`, `.env`, `.htaccess`, `uploads/*`, `cache/*`) |
| 4a. Bootstrap | Activate plugins/themes | `wp plugin activate` / `wp theme activate` |
| 4b. DB Migration | 9-step WordPress standard | `wp option update home/siteurl` → `wp search-replace --dry-run` → actual replace → `wp cache flush` → `wp rewrite structure` → `wp rewrite flush` → `wp transient delete --all` → SQL transient cleanup |
| 4c. Env Config | Staging safety | `wp config set WP_DEBUG false`, `WP_DEBUG_LOG true`, etc. |
| 5. Seed | Data bootstrap | `wp eval-file` (optional) |
| 6. Smoke | HTTP gate | `GET /wp-json/` → expect 200 |

### `git_deploy`

Use this when your real deployment path is:

1. local Git repository
2. push to cPanel-managed repository
3. trigger cPanel deployment task

For this mode, `whc_deploy` uses:

1. `repository_root` as the remote cPanel-managed repository path
2. optional `branch` if you want to deploy a specific branch

## First Practical Step

Run a readiness check against the actual project folder you want to manage:

```powershell
npx -y devops-whc --check-generic --project-root D:/Source/mytho/source/wordpress
```

What this does:

1. validates the target project layout
2. bootstraps hidden WHC state under that project
3. tells you exactly which env values are still missing

`--project-root` is required.

`--app-path` is optional.
If omitted, WHC treats `project-root` itself as the app root.

## Commands You Will Actually Use

```powershell
whc --help
whc --probe
whc --check-health
whc --check-generic --project-root D:/Source/mytho/source/wordpress
whc --serve
```

The same commands also work with `npx -y devops-whc ...`.

## VS Code / Copilot Example

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

## Minimum Config Mindset

For `git_deploy`, think:

1. `WHC_API_TOKEN`
2. `WHC_USER`
3. `WHC_HOST`
4. `WHC_PROD_PATH`
5. `repository_root`

For `ssh_scp_wpcli`, think:

1. local WordPress app root
2. staging SSH host/user
3. SSH key or password
4. remote staging path
5. smoke-ready WordPress runtime

## Current Boundary

1. `check:generic` is the main trustworthy readiness/bootstrap gate.
2. `whc_setup_remote` prepares remote Git repository wiring on cPanel.
3. `git_deploy` triggers the cPanel deployment task for the requested `repository_root` and optional `branch`.
4. `ssh_scp_wpcli` is the default mode and executes the full 6-phase pipeline end-to-end.
5. SCP code sync **never deploys** `wp-config.php`, `.env`, `.htaccess`, `uploads/*`, or `cache/*` — protecting WHC staging from local config leaks.
6. DB migration follows WordPress official standards: 9 steps including dry-run search-replace, cache/rewrite/transient cleanup, and SQL-level safety.
7. Environment config bootstrap sets `WP_DEBUG` and related constants appropriately per environment.

## License

ISC
