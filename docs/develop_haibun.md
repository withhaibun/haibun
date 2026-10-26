# Developing Haibun

Clone this repository, then install its packages and build every module:

`npm install`

`npm run build`

While modules change, `npm run build:watch` rebuilds them and shu's bundles.

`npm test` runs every module's unit and integration tests from the root, and `npm run test:watch` runs them on each change.
A module's own `build` and `test` scripts run the same tools for that module alone.

`npm run lint` runs biome and type-checks the features and the tests.

`npm run test:e2e` runs the end-to-end features of `e2e-tests`, then the examples of `AGENTS.md`, which `npm run test:agents`
runs alone. Their browsers come from Playwright: `npx playwright install chromium`.

`npm run depcruise` writes `dependency-graph.html`, a graph of the modules' imports, which needs Graphviz's `dot`.

## Verifying a change

`npm run verify` runs each check that the root package.json lists under `verify`, one after another, and stops at the first that
fails: the build, lint, the unit and integration tests, and the end-to-end features of `e2e-tests` and shu. It runs the features with
`HAIBUN_ONCE`, so a group whose last pass holds against its present dependencies isn't run again. It prints each check's duration
and the lines the working tree changes.

`npm install` points git at the hooks of `@haibun/tooling` (`modules/tooling/hooks`), whose pre-commit hook runs lint and the unit tests, so a commit passes them.

## Developing a repository on Haibun

A repository that builds on Haibun's modules keeps a Haibun checkout in its git-ignored `haibun` folder and lists `haibun/modules/*`
as its npm workspaces, so one `npm install` installs it with Haibun's modules. It names Haibun's tooling by package: its Vitest config
spreads `@haibun/tooling/vitest-preset.js`, its Biome config extends `@haibun/tooling/biome`, its bundles build through
`@haibun/tooling/bundles.js`, and its `prepare` script runs `haibun-install-hooks`. Spopg is one: it clones Haibun on its own branch
into `haibun`, then `npm run setup` installs its packages, builds Haibun, fetches the browsers and models, and builds spopg.
