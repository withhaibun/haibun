[![Haibun unit tests](https://github.com/withhaibun/haibun/actions/workflows/test.yml/badge.svg)](https://github.com/withhaibun/haibun/actions/workflows/test.yml)

# haibun


Haibun is inspired by the literary form that combines descriptive and objective prose with haiku.
The result is a type of literate programming for always up to date specifications, tests, and documentation.

It enables specification driven development, with end to end tests.
This type of development is often tedious to develop,
brittle to changing underlying implementations,
difficult to maintain,
and isolated from general specifications.
While @Haibun may not make this development fun,
it is intended to make it easier to maintain,
with an emphasis on reuse for different deployment environments,
and the ability to link to formal specifications.

Conceptually, there are three "layers" to Haibun:

* A [BDD](https://en.wikipedia.org/wiki/Behavior-driven_development)-like layer,
  with testable descriptions of flows in a project features in plain language
* A domain layer,
  with abstract representations of functionality & data,
  for example, the [Web domains](modules/web-playwright/src/domains.ts)
* An implementation layer,
  where specific testers are written,
  for example,
  tests in a [Web browser](modules/web-playwright/).

Haibun encourages small libraries with minimal, precisely versioned dependencies,
and provides abstract definitions of storage and other testing features,
so specifications and tests can be developed in a way that's not dependant
on any implementation or vendor.

Haibun also encourages creating testing modules and reusable flows,
so each new project requires less original code,
and contributes to existing modules and flows.

See the [modules](modules) directory, and other repos under [the withhaibun org](https://github.com/withhaibun).

# Use in libraries

Normally, libraries from this repository will be included in a project like any other,
or used via the cli, for example, using `npx @haibun/cli`.

Easily add Haibun to an existing library using [scaffolding](modules/utils/README.md#scaffolding)

## Command line interface

haibun runs as a library or from the command line, through the `haibun-cli` command that `@haibun/cli` provides.
The command starts actuality from one or more folders of features. Actuality is haibun's name for the live system and
the record of each step it performs. Each folder holds a `config.json` that lists the steppers actuality loads, and a
`features` folder with the features actuality runs.

Adding `--help` to a folder lists the command's own options, followed by the options of every stepper that folder's
`config.json` loads, each as the environment variable that sets it. A folder without a `config.json` lists only the
command's own options.

The end-to-end tests in [e2e-tests](e2e-tests) are folders of this kind, `tests` and `shu-self-test`. From that
directory, this lists the options available to the `tests` features:

`npx haibun-cli --help tests`

# Further Documentation

* [Architecture overview](docs/architecture.md)
* [Guide for humans and LLMs](AGENTS.md)
* [Dependency graph](dependency-graph.html)
* [Feature structure](docs/feature_structure.md)
* [Developing new modules](docs/new_modules.md)
* [Developing Haibun](docs/develop_haibun.md)
* [Debugging steppers](docs/stepping.md)
* [Use in Github Actions](docs/e2e_tests.yml)
* [Run Policy and Permissions](docs/run-policy.md)
* [Versioning and releases](VERSIONING.md)
* [VSCode extension (LSP & MCP)](vscode-extension/README.md)

# Key behaviors, proven by features

Every Haibun feature is the living specification for a behavior: prose describes it, executable steps prove it. The identity and authorization model is documented this way, end to end:

* [Identity and capability authorization](e2e-tests/tests/features/identity-and-capability.feature.ts):
  the instance's self-issued site identity, and the one capability gate every protected action passes, in-process, over
  RPC and over MCP. A statement holds less authority than actuality and never more. A caller presents a signed proof with
  its request, which a verifier the consumer supplies checks, and the proof grants only what it proves.

# Development & Debugging help

When using storage-mem in tests, it may be helpful to use `vi.spyOn(process, 'cwd').mockReturnValue('/');`

It can be handy to access the memfs directoy; use this: `(this.publishStorage as any).debug(`${publishRoot}/tracks/`);``

A few test steppers are provided, such as SetTimeStepper, from '@haibun/core/lib/test/SetTimeStepper.js'.

