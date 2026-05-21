# Versioning

Versions come from commit messages, not typed by hand. semantic-release reads the commits since the last tag, decides whether the change is a patch, minor, or major bump, writes the new version into every module, tags the commit, publishes to npm, and updates `CHANGELOG.md`. The whole repo ships one version — `scripts/sync-versions.mjs` keeps every module under `modules/tsconfig.json` aligned with the root, so `@haibun/cli@4.0.0` always pairs with `@haibun/core@4.0.0`. Internal `@haibun/*` deps use `*`, which resolves to the workspace copy.

There are two release lines. `3.x` is the stable line — its releases become `@latest` on npm, so a plain `npm install @haibun/core` gets a 3.x version. The branch is pinned to the `3.x` semver range, so a `BREAKING CHANGE` commit fails the release rather than silently jumping to 4. `4.x` is the next major; its releases go under the `@next` dist-tag, so `npm install @haibun/core@next` opts in. 4.x doesn't displace `@latest`.

## Shipping a change

Work on a topic branch off `3.x` or `4.x`, open a PR, and write the PR title in [conventional commits](https://www.conventionalcommits.org/) form — that's what semantic-release reads at squash-merge time. `feat:` triggers a minor bump, `fix:` a patch, `chore:` or `ci:` no release. A `BREAKING CHANGE:` footer triggers a major bump (only meaningful on 4.x — 3.x's range pin rejects it). Granular changelog bullets go in the PR body and end up in the GitHub release notes.

After merge, CI runs semantic-release end to end. The bump comes back as `chore(release): X.Y.Z [skip ci]` so it doesn't trigger another release loop.

## Adding a module

Add its path to `modules/tsconfig.json` references and the release pipeline picks it up automatically. A module left out stays at whatever version is in its own `package.json` and isn't published — useful for internal-only modules like `e2e-tests`.

## Manual publish

If CI is down, `node scripts/publish-all.mjs [dist-tag]` publishes the current checked-out tree. It refuses to run if module versions have drifted from the root, so run `scripts/sync-versions.mjs <version>` first if needed. There's also a `Publish all (manual)` workflow on Actions that does the same thing from CI — handy when a release commit landed but the publish step failed.

## How it's set up on GitHub

Each release branch carries its own [`.releaserc.json`](.releaserc.json) listing just that branch — `3.x` lists `3.x`, `4.x` lists `4.x`. Cross-branch awareness isn't needed because semantic-release only releases the branch it's running on. The `range`/`channel` settings there decide which npm dist-tag a release lands under.

CI lives in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). On every push to `3.x` or `4.x` it runs the test job and, if that passes, a release job that calls `npx semantic-release`. PRs run tests only. The release job also exists as a standalone manual workflow at [`.github/workflows/publish-all.yml`](.github/workflows/publish-all.yml) for when semantic-release succeeds but the publish step has to be retried by hand.

Pushing the `chore(release):` commit and the version tag back to `3.x` would normally be blocked by the branch's ruleset ("Changes must be made through a pull request"). The release job authenticates as a GitHub App — `haibun-release-bot` — whose actor ID is on the ruleset's bypass list. The job mints a short-lived installation token via `actions/create-github-app-token@v1`, hands it to `actions/checkout` with `persist-credentials: true`, and semantic-release's `git push` rides on that credential.

Three repo secrets feed this:

- `RELEASE_APP_ID` — the App ID of `haibun-release-bot` (a plain integer).
- `RELEASE_APP_PRIVATE_KEY` — the PEM-formatted private key downloaded when the App was created.
- `NPM_TOKEN` — an npm Automation token with publish access to the `@haibun` scope.

When publish fails with a 404 on PUT to `registry.npmjs.org`, the NPM_TOKEN has expired or lost scope access; rotate it on npmjs.com and update the secret. When push fails with `GH013: Repository rule violations`, the App is missing from the bypass list (or a *classic* branch protection rule is layered on top of the ruleset and the bypass-list mechanism doesn't reach it).
