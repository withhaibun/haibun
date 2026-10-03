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

### Adding steppers for one start

A stepper is a module that provides steps. A step is one line a feature can run, such as `go to the "…" webpage`,
which the web-playwright stepper provides. A folder's `config.json` lists the steppers its features use.

`--with-steppers` adds steppers for one start of the command, and leaves `config.json` as it is. Several steppers are
separated by commas. A stepper that `config.json` already lists is loaded once.

This runs the feature `a11y-pass` from the `tests` folder with two more steppers, from the [e2e-tests](e2e-tests)
directory. The steppers are shu's, which the next section describes. With them, the command also writes a report of
the feature, and logs the report's address as `shu standalone report: file://…/shu.html`:

`npx haibun-cli --with-steppers=@haibun/shu/shu-stepper,@haibun/shu/monitor-stepper tests a11y-pass`

### Watching features run, in a browser

shu is haibun's browser interface. It shows what the features did: each step and whether it passed, what each step
saved (a screenshot, an accessibility report), and the records the steps wrote. The monitor is the stepper that
serves shu for the features the command runs. The features themselves don't change.

This runs the same feature and serves shu for it, from the same directory:

```
HAIBUN_STAY=always \
HAIBUN_O_MONITORSTEPPER_PORT=7777 \
HAIBUN_O_WEBSERVERSTEPPER_ALLOW_WITHOUT_DELEGATION='*' \
npx haibun-cli --with-steppers=@haibun/shu/shu-stepper,@haibun/shu/monitor-stepper,@haibun/shu/graph-source-stepper,@haibun/shu/client-cache-stepper tests a11y-pass
```

The three settings:

| Setting | What it does |
|---|---|
| `HAIBUN_O_MONITORSTEPPER_PORT=7777` | The port the monitor serves shu on. The page is `http://localhost:7777/monitor`. Without this setting, the monitor doesn't serve a page. |
| `HAIBUN_STAY=always` | Keeps the command running after the last feature, so the page can still be read. Stop it with Ctrl-C. Without this setting, the command and the page end with the last feature. |
| `HAIBUN_O_WEBSERVERSTEPPER_ALLOW_WITHOUT_DELEGATION='*'` | Lets any browser that reaches the port read the page and call its steps. Without it, shu refuses a browser that an owner hasn't given access. Use `'*'` only on a machine that other people can't reach. |

The four steppers:

| Stepper | What it adds |
|---|---|
| `@haibun/shu/monitor-stepper` | The monitor: it serves shu on its port and sends the page each step as it happens. |
| `@haibun/shu/shu-stepper` | The shu page itself. |
| `@haibun/shu/graph-source-stepper` | The page's reads of the records the steps wrote. |
| `@haibun/shu/client-cache-stepper` | The list of the features the page has read, where an earlier feature is opened again. |

As it starts, the command logs the page's address:

`the monitor shows actuality at http://localhost:7777/monitor`

Each view of the page has an address of its own:

| Address | What it shows |
|---|---|
| `http://localhost:7777/monitor#?col=shu-monitor-column&col=shu-document-column` | The log of each step beside the document. This is the address to start with. |
| `http://localhost:7777/monitor#?col=shu-document-column` | The feature as a document: its prose and steps in order, with what each step saved beneath the step. The accessibility report is shown there, under the step that checked the page. |
| `http://localhost:7777/monitor#?col=shu-monitor-column` | The log: one line for each step, with its time and whether it passed. |
| `http://localhost:7777/monitor#?label=TestResult` | The records of one type, here each accessibility result with its outcome. Another type's name in place of `TestResult` shows that type. |
| `http://localhost:7777/monitor#?col=shu-client-cache-column` | "Executions this device holds": each feature the page has read. A feature's name there opens that feature again. |

The page shows the feature that is running. With several features, the page moves to each feature as it starts, and
the last address above opens an earlier one. `tests a11y` in place of `tests a11y-pass` runs two, `a11y-fail` and then
`a11y-pass`. The page lists a feature only where the page was open while that feature ran.

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

