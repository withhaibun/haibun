# Developing new modules

NB: Normally, you'd use the [[scaffold command](../modules/utils/README.md#scaffolding](https://github.com/withhaibun/haibun/blob/main/modules/utils/README.md#scaffolding)).

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
import { OK, TNamed, AStepper, TWorld } from '@haibun/core/lib/defs.js';
import { actionNotOK, stringOrError, findStepperFromOption } from '@haibun/core/lib/util/index.js';
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage/domain-storage.js';
import { AStorage } from '@haibun/domain-storage/AStorage.js';

const STORAGE = 'STORAGE';

const FilesExist = class FilesExist extends AStepper implements IHasOptions {
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
		this.storage = findStepperFromOption(steppers, this, this.getWorld().moduleOptions, STORAGE);
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
				return exists ? actionNotOK(`${what} is not missing`) : OK;
			},
		},
	};
};
```

After compilation, you can now use statements like _file "README.md" exists_ and
_missing file "missing.md"_ in your features.
Using your module will require including a storage implementation as well,
for example, storage-fs,
or potentially multiple implementations via runtime variables,
which would be specified via the testing repository's package.json, config.json,
and a HAIBUN_O_FILESEXIST_STORAGE runtime variable.

## gwta statements

`AStepper` steps specify their statements using either `exact`, `match` (regex) or `gwta`.
`gwta` is most useful, since it supports variable resolution.
Given, when, then, and are optional in these statements.

### Domain-driven placeholders

Placeholders are declared inside `{}` and have the form `{name[:domain]}`.

Examples:

- `{what}` → domain defaults to `string`.
- `{ms:number}` → domain is `number` (value will be coerced / validated).
- `{target:${DOMAIN_PAGE_SELECTOR}}` → domain is `page-selector`.
- `{when:$DOMAIN_STATEMENT}` → domain is `statement` (an embedded Haibun statement that must itself resolve to a known step).

Internally every placeholder is represented with a mandatory `domain` field. If you omit `:domain` in the gwta text, the parser assigns `string` – so the domain is still present in the runtime model even when you don't write it explicitly.

#### Built‑in domains

Current built-ins:

- `string` – raw text (default)
- `number` – coerced via `Number(value)`; fails if `NaN`
- `css-selector` – treated as opaque string, but distinguished for tooling / IDEs
- `json` – parses JSON; fails on invalid syntax
- `statement` – nested step statement (is parsed & must resolve to an existing step)

#### Domain registry

Domains are resolved at runtime through a registry on the `world` (`world.domains`). Each domain entry provides a `coerce(raw: string)` function returning the typed value or throwing an error string / Error. Adding a new domain is as simple as registering it before steps execute:

```ts
world.domains['uuid'] = {
	coerce: (raw) =>
		/^[0-9a-f-]{36}$/i.test(raw)
			? raw
			: (() => {
					throw new Error(`invalid uuid ${raw}`);
				})(),
};
```

#### Validation & errors

- Unknown domain name → immediate error: `unknown domain 'x'`.
- Coercion failure (e.g. `{age:number}` with `abc`) → error from domain coercer.
- `{x:${DOMAIN_STATEMENT}}` whose inner text does not resolve to a known step → `statement '...' invalid`.

#### Authoring guidelines

- Prefer explicit domains when semantic meaning or validation matters (`{ms:number}` over `{ms}`).
- Use kebab-case for multi-word domain names (`css-selector`).
- Keep domains narrowly focused; compose behavior in step actions, not coercers.
- If your step depends on a new data shape, add a domain instead of ad-hoc parsing inside many steps.

#### Example

```ts
steps = {
	pauseSeconds: {
		gwta: `pause for {ms:${DOMAIN_NUMBER}}s`,
		action: async ({ ms }) => {
			await delay(ms * 1000);
			return OK;
		},
	},
	click: {
		gwta: `click {selector:${PAGE_SELECTOR}}`,
		action: async ({ selector }) => this.page.click(selector),
	},
	conditional: {
		gwta: `if {when:${DOAIN_STATEMENT}}, {what:${DOAIN_STATEMENT}}`,
		action: async ({ when, what }) => {
			/* both are previously resolved statement strings */
		},
	},
};
```

### Backwards compatibility note

Earlier versions referred to `type` on placeholders. This has been replaced with `domain`; the concept is the same, but now all placeholders have a domain internally (defaulting to `string` when omitted) and the runtime registry enables extensibility & validation.

...

For an example module external to the main haibun project, please refer to [haibun sarif](https://github.com/withhaibun/haibun-sarif).

It may be helpful to refer to the [haibun e2e-tests](https://github.com/withhaibun/haibun-e2e-tests) repository, which contains running examples of integration tests. For example, set up that repository, and run `npm run test-xss`.

haibun-e2e-tests contains an example of adding a route to a runtime web server (_start test route at {loc}_)
in its src directory.
