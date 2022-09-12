[![unit tests Actions Status](https://github.com/vid/haibun/workflows/unit-tests/badge.svg)](https://github.com/vid/haibun/actions)

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

Haibun encourages small libraries with minimal, precisely versioned dependencies, 
and provides abstract definitions of storage and other testing features, 
so specifications and tests can be developed in a way that's not dependant 
on any implementation or vendor.

Haibun also encourages creating testing modules and reusable flows, 
so each new project requires less original code, 
and contributes to existing modules and flows.

See the [modules](modules) directory, and other repos under [the withhaibun org](https://github.com/withhaibun).


# Feature structure

```
project/
  config.json
  features/
    test.feature
    ...
  backgrounds/
    setup.feature
      dependant/
      run.feature
```

The haibun command line uses a folder parameter, which would be project in the above example.

Features can use the directive `Backgrounds: <features>` or `Scenarios: <features>` 
which will prepend comma-separated named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature includes run.feature, 
that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

Haibun modules are specified in the project package.json, and a config.json file with specific features.

## Command line interface

haibun can be used as a library or via the cli. 
To see a list of cli option for a particular set of features, use `--help` along with the feature folder.
For example, in [the haibun-e2e-tests repository](https://github.com/withhaibun/haibun-e2e-tests), 
use this command to see available options:

`npx @haibun/cli --help local`

# Installation

Normally, libraries from this repository will be included in a project like any other, 
or used via the cli, for example, using `npx @haibun/cli`.


# Developing new modules

A new Haibun module is created by extending the `AStepper` abstract class from
@haibun/core (see example below), and adding the module to the testing target
directory (refer to the e2e-tests files package.json and local/config.json for
what this should look like).

For example, to create a new module that verifies files exist, using Haibun's
abstract storage, you might do the following;

`mkdir haibun-files-exist`

`npm init`

`npm i @haibun/core @haibun/domain-storage`

Instrument your repository for Typescript and tests as appropriate (see haibun-sarif for an example, 
or use Haibun's scaffolding).

Create an appropriate source file, for example, src/files-exist.ts

Extend the `AStepper` abstract class, and the appropriate properties and methods.

Your file might end up looking like this:

```typescript
import { OK, TNamed, IHasOptions, IRequireDomains, AStepper, TWorld } from '@haibun/core/build/lib/defs';
import { actionNotOK, stringOrError, findStepperFromOption } from '@haibun/core/build/lib/util';
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage';
import { AStorage } from '@haibun/domain-storage/build/AStorage';

const STORAGE = 'STORAGE';

const FilesExist = class FilesExist extends AStepper implements IHasOptions, IRequireDomains {
    requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
    options = {
        [STORAGE]: {
            required: true,
            desc: 'Storage for file tests',
            parse: (input: string) => stringOrError(input),
        },
    };
    storage?: AStorage;
    async setWorld(world: TWorld, steppers: AStepper[]) {
        super.setWorld(world, steppers);
        this.storage = findStepperFromOption(steppers, this, this.getWorld().extraOptions, STORAGE);
    }
    steps = {
        fileExists: {
            gwta: `file {what} exists`,
            action: async ({ what }: TNamed) => {
                const exists = this.storage?.exists(what);
                return exists ? OK : actionNotOK(`${what} does not exist`);
            },
        },
        fileDoesNotExist: {
            gwta: `missing file {what}`,
            action: async ({ what }: TNamed) => {
                const exists = this.storage?.exists(what);
                return exists ?  actionNotOK(`${what} is not missing`) : OK;
            },
        }
    }
}
```

After compilation, you can now use statements like _file "README.md" exists_ and
_missing file "missing.md"_ in your features. 
Using your module will require including a storage implementation as well, 
for example, storage-fs, 
or potentially multiple implementations via runtime variables,
which would be specified via the testing repository's package.json, config.json, 
and a HAIBUN_O_FILESEXIST_STORAGE runtime variable.

## Scaffolding

You can also scaffold Haibun into an existing project using `npm @haibun/core scaffold`. 
This will add the core library, Typescript and Jest support (if missing), 
steppers, a library, and tests. 
It won't overwrite existing files. It presumes an src folder for source files.

## gwta statements

`AStepper` steps specify their statements using either `exact` or `gwta`. 
`gwta` is more useful, 
since it supports BDD style Given, When, Then, And prefixes. 
Additionally, it supports the haibun abstract data model for input, 
where names in curly braces,
for example {name}, are resolved to a type, 
which is string if unspecified.

...

For an example module external to the main haibun project, please refer to [haibun sarif](https://github.com/withhaibun/haibun-sarif).

It may be helpful to refer to the [haibun e2e-tests](https://github.com/withhaibun/haibun-e2e-tests) repository, which contains running examples of integration tests. For example, set up that repository, and run `npm run test-xss`.

haibun-e2e-tests contains an example of adding a route to a runtime web server (_start test route at {loc}_) 
in its src directory.

# Developing Haibun

Installation uses a shell script, which is tested in Linux & macOS,
and should also work on Windows using WSL.

Clone this repo, 
and install Lerna and Typescript globally;

`npm i -g lerna typescript`

To build:

  `npm run build`

  `npm run tsc-watch`

Use this at the top level to build and watch all modules.

Top level tests for all modules are also available:

`npm run test`

or

`npm run test-watch`

Each module can be developed independently using: 

`npm run tsc-watch`  # not needed if using top-level `tsc-watch`

`npm test`

or 

`npm run test-watch`

## Developing modules and Haibun core together

To develop your own separate module while developing Haibun modules, use:

`npm link @haibun/core`

and any other modules you may need.

