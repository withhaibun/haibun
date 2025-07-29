[![Haibun unit tests](https://github.com/withhaibun/haibun/actions/workflows/test.yml/badge.svg)](https://github.com/withhaibun/haibun/actions/workflows/test.yml)

# haibun

Haibun is inspired by the literary form that combines descriptive and objective prose with haiku.

This package is intended to enable specification driven development, with end to end tests.
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
  for example, the [Web](modules/domain-webpage)
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

haibun can be used as a library or via the cli.
To see a list of cli option for a particular set of features, use `--help` along with the feature folder.
For example, in [the haibun-e2e-tests repository](https://github.com/withhaibun/haibun-e2e-tests),
use this command to see available options:

`npx @haibun/cli --help local`

# Further Documentation

* [Dependency graph](dependency-graph.html)
* [Feature structure](docs/feature_structure.md)
* [Developing new modules](docs/new_modules.md)
* [Developing Haibun](docs/develop_haibun.md)
* [Debugging steppers](docs/stepping.md)
* [Using MCP](modules/mcp/README.md)

# Development & Debugging help

When using storage-mem in tests, it may be helpful to use `vi.spyOn(process, 'cwd').mockReturnValue('/');`

It can be handy to access the memfs directoy; use this: `(this.publishStorage as any).debug(`${publishRoot}/tracks/`);``

A few test steppers are provided, such as SetTimeStepper, from '@haibun/core/lib/test/SetTimeStepper.js'.

