# Versioning

One version number is shared across all modules. Bumping it runs tests, updates every module, commits, tags, and pushes.

## Quick reference

Starting from `3.8.4`:

```sh
# Preview releases (alpha → beta → rc)
npm run version-alpha            # → 3.8.5-alpha.0
npm run version-alpha            # → 3.8.5-alpha.1   (repeat to iterate)
npm run version-alpha:minor      # → 3.9.0-alpha.0
npm run version-alpha:major      # → 4.0.0-alpha.0

npm run version-beta             # → same version, -beta.0
npm run version-rc               # → same version, -rc.0
npm run version-graduate         # drops the suffix: 4.0.0-rc.0 → 4.0.0

# Final releases (skip previews)
npm run version-patch            # 3.8.4 → 3.8.5
npm run version-minor            # 3.8.4 → 3.9.0
npm run version-major            # 3.8.4 → 4.0.0
```

Then publish:

```sh
npm run publish-all              # final releases
npm run publish-all:alpha        # alpha previews
npm run publish-all:beta         # beta previews
npm run publish-all:rc           # rc previews
```

## Multiple release lines

`main` currently ships `4.x` alphas. The `3.x` branch still gets patch releases.

Each branch bumps its own version independently — run `version-patch` on `3.x` to ship `3.8.6`, run `version-alpha` on `main` to ship the next `4.0.0-alpha.N`. Publish `3.x` finals with `publish-all` (they become `@latest` on npm); publish `4.x` previews with `publish-all:alpha` (they go under the `@alpha` tag and don't displace `@latest`).

## What a bump does

1. Runs `npm run test`. If tests fail, nothing is bumped.
2. Writes the new version into every `modules/*/package.json` and into `modules/core/src/currentVersion.ts`.
3. Creates a git commit and tag.
4. Pushes the commit and tag.

Internal `@haibun/*` dependencies use `*`, so modules always resolve to the matching workspace version.

## Skipping tests (hotfix)

```sh
npm version patch --ignore-scripts
node scripts/sync-versions.mjs
git add -A && git commit -m "v$(node -p 'require(\"./package.json\").version')"
git tag "v$(node -p 'require(\"./package.json\").version')"
git push && git push --tags
```
