# Developing Haibun

Clone this repository, then install its packages and build every module:

`npm install`

`npm run build`

While modules change, `npm run build:watch` rebuilds them and shu's bundles.

`npm test` runs every module's unit and integration tests from the root, and `npm run test:watch` runs them on each change.
A module's own `build` and `test` scripts run the same tools for that module alone.

`npm run lint` runs biome and type-checks the features and the tests.

The end-to-end features run from `e2e-tests` with `npm run test:e2e`. Their browsers come from Playwright:
`npx playwright install chromium`.

`npm run depcruise` writes `dependency-graph.html`, a graph of the modules' imports, which needs Graphviz's `dot`.

## Developing modules and Haibun core together

To develop a separate module beside Haibun's modules, link each Haibun library into that module's repository:

`npx @haibun/utils -p link`

This links each Haibun library to a Haibun repository linked with `npm link`, which runs once in each Haibun module's
directory.

