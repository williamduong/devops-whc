# devops-whc

Development workspace for `devops-whc`, a WHC cPanel automation CLI and stdio tool server.

This repository is for contributors who need to:

1. develop and test the CLI locally
2. evolve deploy/check contracts
3. prepare and publish the npm package

If you only want to use the package, read the npm package README instead of this repo README.

## Repo Layout

- `src/`: TypeScript source
- `tests/`: test suite
- `scripts/`: build, sync, and publish helpers
- `packages/devops-whc`: publishable npm package folder

## Dev Setup

```powershell
npm install
npm run build
```

Useful local commands:

```powershell
npm run help
npm run serve
npm run probe
npm run check:generic
npm run check:health
npm run typecheck
npm test
```

## Local Dev Flow

1. Put local credentials in `.env`.
2. Run `npm run check:generic -- <project-root>` against a real target project.
3. Start the server with `npm run serve`.
4. Iterate on source, tests, and docs.

`check:generic` is the main readiness/bootstrap path for project-local hidden WHC state.

## Workflow Modes

### `ssh_scp_wpcli`

Default mode for `mytho/source` style delivery. Full 6-phase pipeline:

| Phase | What it does |
|---|---|
| 1. Doctor | SSH, WP-CLI, remote path, HTTP probe |
| 2. Backup | `wp db export` with audit trail |
| 3. SCP Sync | SFTP upload (skips `wp-config.php`, `.env`, `.htaccess`, `uploads/*`, `cache/*`) |
| 4a. Bootstrap | Activate plugins/themes via WP-CLI |
| 4b. DB Migration | 9-step WordPress standard: home/siteurl → search-replace (dry-run first) → cache → rewrite → transients |
| 4c. Env Config | `wp config set WP_DEBUG` etc. per environment |
| 5. Seed | `wp eval-file` (optional) |
| 6. Smoke | HTTP GET `/wp-json/` |

### `git_deploy`

Repository-driven cPanel flow.

Mindset:

1. local git repository
2. push to cPanel-managed repository
3. trigger cPanel deployment task
4. `.cpanel.yml` drives deploy behavior

## Docs Map

- `README.md`: this repo, for contributors
- `README.npm.md`: published npm README, for end users
- `AGENT_USAGE.md`: operator/agent usage model
- `WHC_REQUIREMENTS.md`: requirements and constraints

## Release Workflow

Run these from repository root:

```powershell
npm run typecheck
npm test
npm run publish:prepare
npm run pack:check
```

Publish after validation:

```powershell
npm run publish:npm
```

Notes:

1. `publish:prepare` syncs built artifacts and publish docs into `packages/devops-whc`.
2. `pack:check` dry-runs the real npm tarball from `packages/devops-whc`.
3. `publish:npm` publishes from `packages/devops-whc`, not from repo root.
4. npm publish auth is a maintainer concern and belongs to this repo workflow, not end-user docs.

## License

ISC
