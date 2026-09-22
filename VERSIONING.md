# Versioning

Versions are derived from commit history. `semantic-release` analyzes the commits since the last tag, selects the next version, updates the workspace packages, tags the release, publishes to npm, and updates `CHANGELOG.md`. The repo ships a single version across all published modules. `scripts/sync-versions.mjs` keeps every package referenced by `modules/tsconfig.json` aligned with the root version.

`3.x` is the stable line and publishes to the npm `latest` dist-tag. `4.x` is the next major line and publishes to `next`.

## Shipping a change

Start from `3.x` or `4.x`, open a PR, and ensure the commit that lands on the release branch uses [Conventional Commits](https://www.conventionalcommits.org/). `semantic-release` analyzes the target branch history, not the PR title in isolation, so the final commit subject matters. A squash merge such as `fix: switch to trusted publishing` releases; a merge commit such as `Merge pull request #123 ...` does not.

`feat:` produces a minor release. `fix:` produces a patch release. `chore:` and `ci:` do not release. `BREAKING CHANGE:` produces a major release, but `3.x` is range-pinned, so a breaking change there fails instead of rolling to `4.0.0`.

After merge, CI runs `semantic-release`. The generated release commit is `chore(release): X.Y.Z [skip ci]`.

## Adding a module

Add the module to `modules/tsconfig.json` references and the release pipeline will include it automatically. Modules left out keep their own `package.json` version and are not published. That is useful for internal-only packages such as `e2e-tests`. Modules to be published must have trusted publishing enabled individually.

## Manual publish

If CI is unavailable, `node scripts/publish-all.mjs [dist-tag]` publishes the checked-out tree. It refuses to run if any module version differs from the root version; if needed, run `scripts/sync-versions.mjs <version>` first. The `Publish all (manual)` GitHub Actions workflow runs the same publish path and is useful when the release commit landed but npm publish failed.

## How it's set up on GitHub

Each release branch carries its own [`.releaserc.json`](.releaserc.json). `semantic-release` only releases the branch it is running on, so the branch-local config defines which line that branch may publish. In this checkout, the config currently authorizes `3.x` only.

CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Pushes to `3.x` and `4.x` run tests and, if they pass, a release job that runs `npx semantic-release`. PRs run tests only. Because release authorization comes from the branch-local `.releaserc.json`, `4.x` also needs its own matching release config when that line is wired in. The same publish path is also available through [`.github/workflows/publish-all.yml`](.github/workflows/publish-all.yml) for retrying npm publish after a successful release commit.

The release job pushes the `chore(release):` commit and version tag as the GitHub App `haibun-release-bot`. Because the branch ruleset blocks ordinary direct pushes, the job mints a short-lived installation token with `actions/create-github-app-token@v1`, passes it to `actions/checkout` with `persist-credentials: true`, and lets `semantic-release` push with that token.

npm publishing uses GitHub Actions OIDC trusted publishing. npm must trust the workflow identity that is actually publishing: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for automatic releases, and optionally [`.github/workflows/publish-all.yml`](.github/workflows/publish-all.yml) for manual retries.

Two repo secrets feed this:

- `RELEASE_APP_ID` — the App ID of `haibun-release-bot` (a plain integer).
- `RELEASE_APP_PRIVATE_KEY` — the PEM-formatted private key downloaded when the App was created.

If publish fails with a 404 on `PUT https://registry.npmjs.org`, the `@haibun` scope or package-level trusted publisher configuration does not match the workflow identity that is publishing. If push fails with `GH013: Repository rule violations`, the GitHub App is missing from the bypass list, or a classic branch protection rule is still enforcing direct-push restrictions separately from the ruleset.
