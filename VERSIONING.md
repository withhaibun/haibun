# Versioning

Haibun uses npm's built-in `version` lifecycle to manage releases across all workspace modules.

## TL;DR

Starting from `3.8.4`:

```sh
# start a patch-level alpha (next patch: 3.8.5)
npm run version-alpha            # → 3.8.5-alpha.0
npm run version-alpha            # → 3.8.5-alpha.1

# start a minor-level alpha (next minor: 3.9.0)
npm run version-alpha:minor      # → 3.9.0-alpha.0

# start a major-level alpha (next major: 4.0.0)
npm run version-alpha:major      # → 4.0.0-alpha.0
npm run version-alpha            # → 4.0.0-alpha.1  (keeps incrementing within the preid)

# promote through the lifecycle
npm run version-beta             # → 4.0.0-beta.0
npm run version-rc               # → 4.0.0-rc.0
npm run version-graduate         # → 4.0.0          (strips prerelease)

# or skip prerelease entirely:
npm run version-patch            # 3.8.4 → 3.8.5
npm run version-minor            # 3.8.4 → 3.9.0
npm run version-major            # 3.8.4 → 4.0.0
```

Each command runs tests, syncs all workspace versions, commits, tags, and pushes.
Publish separately with `npm run publish-all` (or `publish-all:tag -- alpha` for prereleases).

## How it works

Running any `npm run version-*` script triggers this lifecycle:

1. **preversion** — runs `npm run test`
2. **version** — `scripts/sync-versions.mjs` propagates the new version to all workspace `package.json` files and updates `modules/core/src/currentVersion.ts`
3. npm creates a git commit and tag
4. **postversion** — pushes the commit and tag to the remote

## Scripts

| Script | Description |
|---|---|
| `npm run version-alpha` | Next patch alpha (`3.8.4` → `3.8.5-alpha.0`, then `→ alpha.1`, `→ alpha.2`) |
| `npm run version-alpha:minor` | Next minor alpha (`3.8.4` → `3.9.0-alpha.0`) |
| `npm run version-alpha:major` | Next major alpha (`3.8.4` → `4.0.0-alpha.0`) |
| `npm run version-beta` | Promote to beta (`3.9.0-alpha.3` → `3.9.0-beta.0`) |
| `npm run version-rc` | Bump to next release candidate (`3.8.5-beta.2` → `3.8.5-rc.0`) |
| `npm run version-graduate` | Graduate from prerelease to release (`3.8.5-rc.1` → `3.8.5`) |
| `npm run version-patch` | Bump patch version (`3.8.4` → `3.8.5`) |
| `npm run version-minor` | Bump minor version (`3.8.4` → `3.9.0`) |
| `npm run version-major` | Bump major version (`3.8.4` → `4.0.0`) |
| `npm run publish-all` | Publish all workspace packages to npm |
| `npm run publish-all:tag -- <tag>` | Publish with a dist-tag (e.g. `alpha`, `beta`, `next`) |

## Typical release flow

### Prerelease cycle

```sh
npm run version-alpha          # 3.8.4 → 3.8.5-alpha.0
npm run publish-all:tag -- alpha

# iterate on alpha...
npm run version-alpha          # 3.8.5-alpha.0 → 3.8.5-alpha.1
npm run publish-all:tag -- alpha

# promote to beta
npm run version-beta           # 3.8.5-alpha.1 → 3.8.5-beta.0
npm run publish-all:tag -- beta

# promote to release candidate
npm run version-rc             # 3.8.5-beta.0 → 3.8.5-rc.0
npm run publish-all:tag -- rc

# graduate to stable release
npm run version-graduate       # 3.8.5-rc.0 → 3.8.5
npm run publish-all
```

### Direct release (no prerelease)

```sh
npm run version-patch          # 3.8.4 → 3.8.5
npm run publish-all
```

## Skipping tests

If you need to skip the preversion test (e.g. during a hotfix), use npm directly:

```sh
npm version patch --ignore-scripts
node scripts/sync-versions.mjs
git add -A && git commit -m "v$(node -p 'require(\"./package.json\").version')"
git tag "v$(node -p 'require(\"./package.json\").version')"
git push && git push --tags
```

## What gets updated

- Root `package.json` version (by npm)
- All workspace module `package.json` versions (by `sync-versions.mjs`)
- `modules/core/src/currentVersion.ts` (by `sync-versions.mjs`)
- Workspace `@haibun/*` dependencies use `*` wildcards, so they resolve automatically
