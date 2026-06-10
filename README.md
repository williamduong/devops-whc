# devops-whc

WHC cPanel MCP server for deploy, verify, rollback, logs, backup, and health flows.

Current workspace version: 1.0.2-next

## Publish Package Layout

Npm release artifacts are now isolated in a dedicated package folder:

- `packages/devops-whc`

The repository root is the development workspace. The publish package is prepared by syncing built/runtime files into `packages/devops-whc` before packing or publishing.

## What this is

This package exposes an MCP server that VS Code Copilot or any MCP client can launch over stdio. It is designed for WHC cPanel projects and keeps the local workflow, target environment, and safety rules explicit.

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
whc-mcp --help
```

## Quick Start

1. Copy `.env.example` to `.env`.
2. Fill in the required WHC credentials and target paths.
3. Run `npm run mcp:prepare` once per workspace.
4. Start the server with `npm run serve` for local development, or `npx -y devops-whc --serve` after npm install.

If you are using VS Code Copilot MCP, point the server command to the published package or to the local `start-mcp.cjs` helper.

## VS Code MCP Config

Published-package example:

```jsonc
{
  "servers": {
    "whc-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "devops-whc", "--serve"],
      "env": {
        "WHC_ENV_FILE": "${workspaceFolder}/.env",
        "WHC_LOCAL_PROJECT_ROOT": "${workspaceFolder}",
        "WHC_STATE_ROOT": ".mcp/whc-mcp",
        "WHC_MCP_INSTANCE_NAME": "whc-mcp"
      }
    }
  }
}
```

Local-source example:

```jsonc
{
  "servers": {
    "whc-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/start-mcp.cjs"],
      "cwd": "${workspaceFolder}",
      "env": {
        "WHC_ENV_FILE": "${workspaceFolder}/.env",
        "WHC_LOCAL_PROJECT_ROOT": "${workspaceFolder}",
        "WHC_STATE_ROOT": ".mcp/whc-mcp",
        "WHC_MCP_INSTANCE_NAME": "whc-mcp"
      }
    }
  }
}
```

## CLI Commands

```powershell
whc-mcp --serve
whc-mcp --probe
whc-mcp --check-health
whc-mcp --help
whc-mcp --version
```

If you are using the npm package directly, the same commands work through `npx`:

```powershell
npx -y devops-whc --serve
npx -y devops-whc --probe
npx -y devops-whc --check-health
npx -y devops-whc --help
npx -y devops-whc --version
```

## Required Environment Variables

Set these in your local `.env` file:

- `WHC_API_TOKEN`
- `WHC_USER`
- `WHC_HOST`
- `WHC_PROD_SSH_HOST`
- `WHC_PROD_SSH_USERNAME`
- `WHC_PROD_SSH_PRIVATE_KEY_PATH`

## Optional Environment Variables

- `WHC_WORKFLOW_MODE`
- `WHC_PRIMARY_DOMAIN`
- `WHC_TESTING_DOMAIN`
- `WHC_STAGING_DOMAIN`
- `WHC_PROD_PATH`
- `WHC_STAGING_PATH`
- `WHC_REQUIRE_STAGING_CONFIRM`
- `WHC_WARN_DYNAMIC_DATA_SYNC`
- `WHC_ENFORCE_STAGING_FIRST`
- `WHC_ALLOW_STAGING_GIT_CONTROLLED`
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

### 3) Start the MCP server in VS Code

Once the MCP config is in place, Copilot can launch the server and call tools such as `whc_prepare`, `whc_deploy`, `whc_verify`, and `whc_rollback`.

### 4) Prepare workspace state once

```powershell
npm run mcp:prepare
```

This initializes the hidden project state under `.mcp/whc-mcp` and ensures the workspace ignores local management files.

## Safety Notes

1. Never commit `.env` or `.vscode/whc.env`.
2. Keep secrets in your local workspace only.
3. The npm tarball is limited to the published files list and does not include local env files.
4. For staging-to-live or database-changing operations, follow the tool safety prompts and confirm the release intent.

## Publish Checklist

1. `npm run test`
2. `npm run pack:check`
3. `npm run publish:npm`

Notes:
1. `npm run pack:check` automatically runs publish preparation and packs from `packages/devops-whc`.
2. `npm run publish:npm` runs the real publish from `packages/devops-whc`.
3. For prerelease versions like `1.0.2-next`, `npm run publish:npm` automatically publishes with dist-tag `next`.
4. Do not run `npm publish` from the repository root package.

## License

ISC