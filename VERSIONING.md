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
