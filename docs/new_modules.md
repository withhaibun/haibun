
# Developing new modules

NB: Normally, you'd use the [[scaffold command](../modules/utils/README#scaffolding](https://github.com/withhaibun/haibun/blob/main/modules/utils/README.md#scaffolding)). 

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
import { OK, TNamed, IHasOptions, IRequireDomains, AStepper, TWorld } from '@haibun/core/build/lib/defs.js';
import { actionNotOK, stringOrError, findStepperFromOption } from '@haibun/core/build/lib/util/index.js';
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage/build/domain-storage.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';

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
        await super.setWorld(world, steppers);
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
