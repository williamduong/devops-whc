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

## Two Workflow Modes

### `ssh_scp_wpcli`

Default mode. Use this for `mytho/source` style delivery:

1. doctor
2. backup
3. SCP code sync
4. WP-CLI bootstrap
5. seed/bootstrap
6. smoke gate

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
4. `ssh_scp_wpcli` is still the correct default mindset for `mytho/source`.
5. `whc_deploy` does not yet execute the full `ssh_scp_wpcli` runtime pipeline end to end; keep that in project-local scripts.

## License

ISC
