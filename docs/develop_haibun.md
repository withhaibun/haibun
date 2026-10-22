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

`npm run verify` runs each lane that the root package.json lists under `verify`, one after another, and stops at the first that
fails: the build, lint, the unit and integration tests, and the end-to-end features of `e2e-tests` and shu. It runs the features with
`HAIBUN_ONCE`, so a group whose last pass holds against its present dependencies isn't run again. It prints each lane's duration
and the lines the working tree changes.

`npm install` points git at `.githooks`, whose pre-commit hook runs lint and the unit tests, so a commit passes them.

## Developing a repository beside Haibun

A repository that builds on Haibun's modules keeps a Haibun checkout beside it, links that checkout as its `haibun` folder, and lists
`haibun/modules/*` as its npm workspaces. Spopg is one: `ln -s ../haibun haibun`, then `npm run setup` installs its packages, builds
Haibun, fetches the browsers and models, and builds spopg. Its postinstall refuses a `haibun` that is missing, that isn't a link, or
that is on another branch than the repository's, and states the next step.
