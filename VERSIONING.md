# Versioning

Releases are automated by [semantic-release](https://semantic-release.gitbook.io/). Version numbers come from commit messages; the Release workflow publishes. You never type a version number.

## How to ship a change

1. Work on a feature branch. Commit messages on the branch can say anything: they're squashed at merge.
2. Open a PR targeting the right release branch:
   - `main` for stable 3.x (patches + minor features)
   - `alpha` for 4.x previews
3. Write the **PR title** in conventional-commits format. Examples:
   - `feat: add retry logic to http stepper`: triggers a minor bump
   - `fix: monitor crashes on empty trace`: triggers a patch bump
   - `chore: clean up imports`: no release
4. Put bullets in the PR **body** for granular changelog entries.
5. For a breaking change, add a footer to the body:
   ```
   BREAKING CHANGE: kireji withAction signature changed
   ```
6. Squash-merge, then run the Release workflow on the release branch (Actions → Release → Run workflow). A push doesn't start a workflow. The Release workflow runs semantic-release, which bumps all modules, publishes to npm, updates `CHANGELOG.md`, tags, and creates a GitHub release.

## Branches and npm dist-tags

| Branch | npm tag | Version shape |
|---|---|---|
| `main` | `@latest` | `3.8.5`, `3.9.0`, ... (stable 3.x) |
| `alpha` | `@alpha` | `4.0.0-alpha.N` |
| `beta` | `@beta` | `4.0.0-beta.N` |
| `rc` | `@rc` | `4.0.0-rc.N` |

`npm install @haibun/core` gets stable 3.x. 4.x previews require an explicit tag: `npm install @haibun/core@alpha`.

`main` is pinned to the `3.x` range in [.releaserc.json](.releaserc.json): it will not accidentally jump to 4.x. When 4.x is ready to ship as stable, change the `main` range (e.g. to `4.x`) and demote the old line to a maintenance branch.

## One version for all modules

Every workspace that package.json's `workspaces` lists ships at the same version. semantic-release's `@semantic-release/exec` plugin runs npm's own workspace commands: `npm version` sets the release's version in the root and every workspace, and `npm publish --workspaces` publishes each workspace that isn't marked `"private": true` under the branch's dist-tag. Internal `@haibun/*` deps use `*`, so they always resolve to the matching workspace version.

To add a new module to the release, add it under `modules/`, which `workspaces` lists. A module that should never publish, such as `e2e-tests`, is marked `"private": true` in its own `package.json`.

## Checking the current version

```sh
node -p "require('./package.json').version"   # root (source of truth)
npm pkg get version
git describe --tags --abbrev=0                 # latest tag
```

At runtime, `@haibun/core/currentVersion.js` exports `currentVersion`, which it reads from core's `package.json`.

## Required one-time setup in GitHub

Before the first automated release works:

1. Repo secret: `NPM_TOKEN` with publish rights on the `@haibun` scope.
2. Settings → General → Pull Requests: allow **squash merging only**, set "Default to pull request title and description" for squash commits.
3. Create the `alpha` branch from the current 4.x working branch (`centralize-rpc-shu-monitor`).
4. Branch protection on `main` and `alpha`: require PRs, require the "PR Title" check to pass.
