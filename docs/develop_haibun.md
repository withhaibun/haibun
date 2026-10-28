# Developing Haibun

Clone this repository, then install its packages and build every module:

`npm install`

`npm run build`

The build is `tsc -b`, which builds each module after the modules its tsconfig references, the end-to-end tests' server and
the type checks of the features and the tests, then each module's `bundle` script. `npm run clean` removes what it built.

While modules change, `npm run build:watch` rebuilds them and shu's bundles.

`npm test` runs every module's unit and integration tests from the root, and `npm run test:watch` runs them on each change.
A module's own `build` and `test` scripts run the same tools for that module alone.

`npm run lint` runs biome and `tsc -b`.

`npm run test:e2e` is `haibun-cli --groups`, which runs each group of features: a config that declares `group`, such as those of
`e2e-tests`, shu's `tests*`, `mcp-server` and `config.agents.json`, which runs the examples of `AGENTS.md`. Each runs from its
config's directory with the bases and filter its group states, in the order its `after` states, and the group runner stops at the first that
fails. A path after `--groups` narrows it to the configs it names or holds, another word is the feature filter each runs, `--set` and
`--environments` select the groups of a set or that use those environments, `--list` prints the configs it would run, and every
other option, such as `--once` or `--with-steppers=debugger-stepper`, reaches each run. Their browsers come from Playwright:
`npx playwright install chromium`.

`npm run depcruise` writes `dependency-graph.html`, a graph of the modules' imports, which needs Graphviz's `dot`.

## Verifying a change

`npm run build`, `npm run lint`, `npm test` and `npm run test:e2e` check a change, as CI runs them. `npm run test:e2e -- --once` skips
a group whose last pass holds against its present dependencies.

`npm install` points git at the hooks of `@haibun/tooling` (`modules/tooling/hooks`), whose pre-commit hook runs lint and the unit tests, so a commit passes them.

## Developing a repository on Haibun

A repository that builds on Haibun's modules keeps a Haibun checkout in its git-ignored `haibun` folder and lists `haibun/modules/*`
as its npm workspaces, so one `npm install` installs it with Haibun's modules. It names Haibun's tooling by package: its Vitest config
spreads `@haibun/tooling/vitest-preset.js`, its Biome config extends `@haibun/tooling/biome`, its bundles build through
`@haibun/tooling/bundles.js`, and its `prepare` script runs `haibun-install-hooks`. An application repository clones Haibun on its own branch
into `haibun`, then `npm run setup` installs its packages, builds Haibun, fetches the browsers and models, and builds the application.

The repository reads each Haibun package as an ordinary dependency: its build and `.d.ts`, through the package's exports. Haibun builds
before the repository uses a change: `npm run build` in Haibun, or Haibun's `build:watch` running beside the repository's own. The
repository compiles each of its projects with `tsc -p` in reference order, for a check and for its watch, since `tsc -b` compares only a
project's own inputs with its build info and doesn't watch a changed `.d.ts` in a linked package. Only Haibun's own workspace resolves its
packages' source, through the `haibun-source` condition of `workspacePreset` and of shu's bundles.
