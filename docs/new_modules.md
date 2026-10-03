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
- `number` – read as a number; fails if it isn't one
- `css-selector` – treated as opaque string, but distinguished for tooling / IDEs
- `json` – parses JSON; fails on invalid syntax
- `statement` – nested step statement (is parsed & must resolve to an existing step)

#### Domain registry

A stepper declares its domains in its cycles' `getConcerns`, each a `TDomainDefinition` with its selectors, a Zod schema and a description. The schema takes each form of the domain's value, as a feature line, a variable or a call gives it, and yields the value the step receives. It parses that value to itself, and its JSON Schema states the form a call sends. A composite takes its JSON text too, through `fromJsonText`:

```ts
cycles: IStepperCycles = {
	getConcerns: () => ({
		domains: [
			{ selectors: ["uuid"], schema: z.string().uuid(), description: "A UUID" },
			{ selectors: ["point"], schema: fromJsonText(PointSchema), description: "A point" },
		],
	}),
};
```

Only a meta domain whose value depends on the step it fills, such as `statement`, declares a `coerce`.

#### Validation & errors

- A parameter naming a domain that the loaded steppers don't register is refused when the step registers, naming the step and the domain.
- A value its parameter's domain refuses fails the step, naming the step, the parameter, the term and the schema's reason. Text that isn't JSON where JSON text is taken is refused at once, with the parser's reason and the text.
- A variable of another domain fills a parameter only where the parameter's domain is a reference to it: otherwise the step fails, naming both domains.
- `{x:${DOMAIN_STATEMENT}}` whose inner text does not resolve to a known step → `statement '...' invalid`.

#### Authoring guidelines

- Prefer explicit domains when semantic meaning or validation matters (`{ms:number}` over `{ms}`).
- Use kebab-case for multi-word domain names (`css-selector`).
- Keep domains narrowly focused; compose behavior in step actions, not schemas.
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

This repository's [e2e-tests](../e2e-tests) holds running examples of integration tests.
From that folder, `npm run test:tests` runs the `tests` base, and `npx haibun-cli tests xss` runs its features whose
names hold `xss`.
Its [test server stepper](../e2e-tests/src/test-server.ts) adds routes to a running web server.
