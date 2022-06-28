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

Haibun also encouragies creating testing modules and flow, 
so each new project requires less original code, 
and contributes to existing modules and flows.

See the [modules](modules) directory, and other repos under [the withhaibun org](https://github.com/withhaibun).


# Feature structure

```
project/
  features/
    test.feature
  backgrounds/
    setup.feature
      dependant/
      run.feature
```

On running tests, features at the project/ level are run. 

Features can use the directive `Backgrounds: <features>` or `Scenarios: <features>` which will prepend comma-separated named features from backgrounds/.
Background features from further 'down' their tree will include previous features.

So, if test.feature includes run.feature, 
that will includes setup.feature and run.feature before test.feature's steps.

Note that features/ (unlike backgrounds) will not include folder predecessors.

Haibun modules are specified in the project package.json, and a config.json file with specific features.


# Installation

The installation uses a shell script, it is tested in Linux & macOS, and should also work on Windows using WSL.

Clone this repo, and install lerna and typescript globally;

  `npm i -g lerna typescript`

## Command line interface

Haibun can be used as a library or via the cli. 
To see a list of cli option for a particular set of features, use --help along with the feature folder.
For example, in the haibun-e2e-tests repository, you could use this command to see available options:

`npx @haibun/cli --help local`
  
# Development

To build:

  `npm run build`
  `npm run tsc-watch`

Use this at the top level to build and watch all modules.

Each module can be developed independently using: 

  `npm run tsc-watch` 

  `npm test`

To develop your own separate module while developing these Haibun modules, use:

`npm link @haibun/core`

and any other modules you may need.

## Developing new modules

For an example module external to the main haibun project, please refer to [haibun sarif](https://github.com/withhaibun/haibun-sarif).

It may be helpful to refer to the [haibun e2e-tests](https://github.com/withhaibun/haibun-e2e-tests) repository, which contains running examples of integration tests. For example, set up that repository, and run `npm run test-xss`.

...

A new Haibun module is created by implementing the AStepper interface from
@haibun/core (see example below), and adding the module to the testing target
directory (refer to the e2e-tests files package.json and local/config.json for
what this should look like).

For example, to create a new module that verifies files exist, using Haibun's
abstract stoarge, you might do the following;

`mkdir haibun-files-exist`
`npm init`
`npm i @haibun/core @haibun/domain-storage`

Instrument your repository for Typescript and tests as appropriate (see haibun-sarif for an example).

Create an appropriate file, for example, src/files-exist.ts

Add the AStepper interface to it, and add the appropriate properties and methods.

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

After complication, you can now use statements like 'file "README.md" exists' and
'missing file "missing.md"' in your features.

