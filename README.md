# devops-whc

WHC cPanel automation CLI for deploy, verify, rollback, logs, backup, and health flows.

Current workspace version: 1.0.2-next

## Publish Package Layout

Npm release artifacts are now isolated in a dedicated package folder:

- `packages/devops-whc`

The repository root is the development workspace. The publish package is prepared by syncing built/runtime files into `packages/devops-whc` before packing or publishing.

## What this is

This package exposes a stdio tool server and CLI that VS Code Copilot or other clients can launch. It is designed for WHC cPanel projects and keeps the local workflow, target environment, and safety rules explicit.

The server supports both usage patterns:

1. Run from a local clone while developing.
2. Install from npm and launch with `npx` or a global install.

## Install

### From a clone

```powershell
npm install
npm run build
```

### From npm

```powershell
npx -y devops-whc --help
```

Or install globally:

```powershell
npm install -g devops-whc
whc --help
```

## Quick Start

1. Copy `.env.example` to `.env`.
2. Fill in the required WHC credentials and target paths.
3. Run `npm run prepare` once per workspace.
4. Start the server with `npm run serve` for local development, or `npx -y devops-whc --serve` after npm install.

If you are using VS Code Copilot, point the server command to the published package or to the local `start-whc.cjs` helper.

## NPM Scripts (Workspace Root)

Run these from repository root (`devops-whc`):

```powershell
npm run help
npm run serve
npm run start
npm run probe
npm run check:generic
npm run check:health
```

Quality and release scripts:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:check
npm run publish:prepare
```

When to use each:

1. `npm run serve`: run directly from TypeScript source (best for local development).
2. `npm run start`: run built output through `scripts/start-whc.cjs` (best for local runtime behavior similar to published package).
3. `npm run prepare`: initialize local `.whc` state once.
4. `npm run pack:check` / `npm run publish:npm`: publish pipeline scripts.

## NPM Scripts (Publish Subpackage)

If you work inside `packages/devops-whc`, available scripts are:

```powershell
npm --prefix packages/devops-whc run help
npm --prefix packages/devops-whc run start
npm --prefix packages/devops-whc run serve
npm --prefix packages/devops-whc run probe
npm --prefix packages/devops-whc run check:generic
npm --prefix packages/devops-whc run check:health
```

These scripts automatically sync fresh artifacts from root via pre-hooks before execution.

## VS Code Tool Server Config

Published-package example:

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

Local-source example:

```jsonc
{
  "servers": {
    "whc": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/start-whc.cjs"],
      "cwd": "${workspaceFolder}",
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

## CLI Commands

```powershell
whc --serve
whc --probe
whc --check-generic --project-root D:/Source/mytho/source/wordpress --workflow-mode ssh_scp_wpcli
whc --check-health
whc --help
whc --version
```

If you are using the npm package directly, the same commands work through `npx`:

```powershell
npx -y devops-whc --serve
npx -y devops-whc --probe
npx -y devops-whc --check-generic --project-root D:/Source/mytho/source/wordpress --workflow-mode ssh_scp_wpcli
npx -y devops-whc --check-health
npx -y devops-whc --help
npx -y devops-whc --version
```

## Local Run vs Script Run

You can run the tool in both ways:

1. Local development from this repo:
  - Use npm scripts (`npm run serve`, `npm run probe`, `npm run check:generic`, ...).
2. Installed package usage:
  - Use `npx -y devops-whc ...` or global `whc ...`.

You do not have to call custom script files manually in normal usage. The wrapper script (`start-whc.cjs`) is already wired behind `npm run start` and package start flow.

## Required Environment Variables

Base config:

- `WHC_WORKFLOW_MODE`
- `WHC_LOCAL_PROJECT_ROOT`

For `git_deploy`:

- `WHC_API_TOKEN`
- `WHC_USER`
- `WHC_HOST`
- `WHC_PROD_PATH`

For `ssh_scp_wpcli`:

- `WHC_STAGING_SSH_HOST`
- `WHC_STAGING_SSH_USERNAME`
- one of:
  - `WHC_STAGING_SSH_PRIVATE_KEY_PATH`
  - `WHC_STAGING_SSH_PASSWORD`

## Optional Environment Variables

- `WHC_WORKFLOW_MODE`
  - `git_deploy`: local source -> cPanel-managed Git repo -> deployment task
  - `ssh_scp_wpcli`: source-driven workflow like `mytho/source` (doctor + SCP + WP-CLI + smoke)
  - default if omitted: `ssh_scp_wpcli`
- `WHC_PRIMARY_DOMAIN`
- `WHC_TESTING_DOMAIN`
- `WHC_STAGING_DOMAIN`
- `WHC_PROD_PATH`
- `WHC_STAGING_PATH`
- `WHC_REQUIRE_STAGING_CONFIRM`
- `WHC_WARN_DYNAMIC_DATA_SYNC`
- `WHC_ENFORCE_STAGING_FIRST`

- `WHC_STAGING_SSH_HOST`
- `WHC_STAGING_SSH_PORT`
- `WHC_STAGING_SSH_USERNAME`
- `WHC_STAGING_SSH_PRIVATE_KEY_PATH`
- `WHC_STAGING_SSH_PASSWORD`
- `WHC_STAGING_SSH_HOSTKEY`
- `WHC_LOCAL_PROJECT_ROOT`
- `WHC_LOCAL_APP_PATH`
- `WHC_SOURCE_KIND`
- `WHC_DEPLOY_UNIT`
- `WHC_BUILD_COMMAND`
- `WHC_BUILD_ARTIFACT_PATH`
- `WHC_DEFAULT_RELEASE_INTENT`
- `WHC_API_TIMEOUT_MS`
- `WHC_SSH_TIMEOUT_MS`
- `WHC_FLOW_LOG_PATH`
- `WHC_STATE_ROOT`

## Practical Examples

### 1) Check connectivity before deploy

```powershell
npx -y devops-whc --probe
```

This checks the UAPI, SSH, and WP-CLI connectivity signals before a deploy run.

### 2) Run a health check

```powershell
npx -y devops-whc --check-health
```

Use this to inspect disk, SSL, load, and capability state.

### 3) Run deploy readiness check (single command)

```powershell
npx -y devops-whc --check-generic --project-root D:/Source/mytho/source/wordpress --workflow-mode ssh_scp_wpcli
```

Or from local clone:

```powershell
npm run check:generic -- D:/Source/mytho/source/wordpress
```

This command validates whether your local WordPress source shape is compatible with the WHC generic pipeline supported by this tool.

`--project-root` is required. `--app-path` is optional.

If `--app-path` is omitted, WHC treats `project-root` itself as the app root.
If `--app-path` is provided but wrong, the command fails and does not initialize hidden files.

Once the effective app root is valid, the command bootstraps hidden WHC state inside that app directory:

1. `<app-path>/.whc/state/...`
2. `<app-path>/.whc/logs/...`
3. `<app-path>/.whc/env/whc.env`
4. `<app-path>/.whc/env/whc.env.example`

If credentials or SSH keys are still missing for that specific project, the check returns `status=blocked` with exact env keys to fill in the bootstrapped hidden env file.

Current behavior by workflow mode:

1. `git_deploy`: validates local source/layout compatibility for repository-driven cPanel deploy flows, including `.cpanel.yml` at repository root.
2. `ssh_scp_wpcli`: validates the `mytho/source` style contract more directly:
   - deployable plugin/theme entrypoints
   - idempotent seed script
   - local `ssh`/`scp`
   - staging SSH/WP-CLI/path/domain probes
   - `/wp-json/` HTTP readiness

Important current boundary:

1. `check:generic` is the main trustworthy gate for source compatibility and hidden-state bootstrap.
2. `whc_setup_remote` is for wiring remote Git repository metadata on cPanel.
3. `ssh_scp_wpcli` is the default workflow mode for `mytho/source`.
4. `git_deploy` now triggers the cPanel deployment task for the requested `repository_root` and optional `branch`.
5. `whc_deploy` is still not the end-to-end executor for the `mytho/source` SCP/WP-CLI pipeline.

What you need from the result:

1. `ready_for_deploy=true` and `status=ready`: ready to run deploy pipeline.
2. `ready_for_deploy=false` and `status=blocked`: not ready yet.
3. `next_actions`: exact steps to fix before rerun.

You do not need to choose or manage internal source categories. The command applies internal checks and returns one deploy readiness decision plus actionable next steps.

### 4) Start the tool server in VS Code

Once the config is in place, Copilot can launch the server and call tools such as `whc_prepare`, `whc_deploy`, `whc_verify`, and `whc_rollback`.

### 5) Prepare workspace state once

```powershell
npm run prepare
```

This initializes the hidden project state under `.whc` and ensures the workspace ignores local management files.

## Safety Notes

1. Never commit `.env` or `.vscode/whc.env`.
2. Keep secrets in your local workspace only.
3. The npm tarball is limited to the published files list and does not include local env files.
4. For staging-to-live or database-changing operations, follow the tool safety prompts and confirm the release intent.

## Release Prep

Run these from repository root before publishing:

```powershell
npm run typecheck
npm test
npm run publish:prepare
npm run pack:check
```

What each step does:

1. `npm run typecheck`: validates TypeScript before release.
2. `npm test`: runs the test suite.
3. `npm run publish:prepare`: syncs root docs/scripts/build output into `packages/devops-whc`.
4. `npm run pack:check`: dry-runs the actual npm package from `packages/devops-whc`.

Publish only after the dry-run looks correct:

```powershell
npm run publish:npm
```

## NPM Auth

Authenticate npm on this machine before the real publish:

```powershell
npm whoami
npm login
npm whoami
```

If your org uses browser-based auth, npm may open a web flow after `npm login`.

Useful checks:

```powershell
npm config get registry
npm access ls-packages
```

Release notes:

1. `npm run publish:npm` publishes from `packages/devops-whc`, not from repository root.
2. For prerelease versions like `1.0.2-next`, the publish script automatically uses dist-tag `next`.
3. Do not run `npm publish` directly from the repository root package.
4. Be explicit in release notes that `ssh_scp_wpcli` is the default mode for `mytho/source`, while `git_deploy` is the repository-driven cPanel deployment path.

## License

ISC


