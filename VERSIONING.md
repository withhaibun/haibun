# Versioning

Releases are automated by [semantic-release](https://semantic-release.gitbook.io/). Version numbers come from commit messages; CI publishes. You never type a version number.

## How to ship a change

1. Work on a feature branch. Commit messages on the branch can say anything — they're squashed at merge.
2. Open a PR targeting the right release branch:
   - `3.x` for stable 3.x (patches + minor features)
   - `alpha` for 4.x previews
3. Write the **PR title** in conventional-commits format. Examples:
   - `feat: add retry logic to http stepper` — triggers a minor bump
   - `fix: monitor crashes on empty trace` — triggers a patch bump
   - `chore: clean up imports` — no release
4. Put bullets in the PR **body** for granular changelog entries.
5. For a breaking change, add a footer to the body:
   ```
   BREAKING CHANGE: kireji withAction signature changed
   ```
6. Squash-merge. CI runs semantic-release, which bumps all modules, publishes to npm, updates `CHANGELOG.md`, tags, and creates a GitHub release.

## Branches and npm dist-tags

| Branch | npm tag | Version shape |
|---|---|---|
| `3.x` | `@latest` | `3.8.5`, `3.9.0`, ... (stable 3.x) |
| `alpha` | `@alpha` | `4.0.0-alpha.N` |
| `beta` | `@beta` | `4.0.0-beta.N` |
| `rc` | `@rc` | `4.0.0-rc.N` |

`npm install @haibun/core` gets stable 3.x. 4.x previews require an explicit tag: `npm install @haibun/core@alpha`.

`3.x` is pinned to the `3.x` range in [.releaserc.json](.releaserc.json) — it will not accidentally jump to 4.x. When 4.x is ready to ship as stable, change the branch config (e.g. to `4.x`) and demote the old line to a maintenance branch.

## One version for all modules

Every module under `modules/tsconfig.json` ships at the same version. When the root bumps, `scripts/sync-versions.mjs` propagates the new version to every module's `package.json` and to `modules/core/src/currentVersion.ts`. Internal `@haibun/*` deps use `*`, so they always resolve to the matching workspace version.

To add a new module to the release: add it to `modules/tsconfig.json` references. It's then built, versioned, and published automatically.

Modules that should never publish (e.g. `recorder`, `e2e-tests`) are marked `"private": true` in their own `package.json` and left out of `modules/tsconfig.json`.

## Local escape hatches

The `version-*` and `publish-all*` npm scripts still exist for emergencies (CI down, hotfix, etc.). They do exactly what they say — read [scripts/sync-versions.mjs](scripts/sync-versions.mjs) and [scripts/publish-all.mjs](scripts/publish-all.mjs). Prefer the CI flow.

## Checking the current version

```sh
node -p "require('./package.json').version"   # root (source of truth)
npm pkg get version
git describe --tags --abbrev=0                 # latest tag
```

At runtime, `currentVersion` is exported from `@haibun/core`.

## Required one-time setup in GitHub

Before the first automated release works:

1. Repo secret: `NPM_TOKEN` with publish rights on the `@haibun` scope.
2. Settings → General → Pull Requests: allow **squash merging only**, set "Default to pull request title and description" for squash commits.
3. Create the `alpha` branch from the current 4.x working branch (`centralize-rpc-shu-monitor`).
4. Branch protection on `3.x` and `alpha`: require PRs, require the "PR Title" check to pass.
