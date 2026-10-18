# Developing new modules

Start a new module with the [scaffold command](https://github.com/withhaibun/haibun/blob/main/modules/utils/README.md#scaffolding).
It adds Haibun to a new or existing project.

A Haibun module defines a stepper class that extends the `AStepper` abstract class that `@haibun/core/lib/astepper.js` exports.
The test project lists the module as a dependency in its `package.json`.
A test base loads each stepper that the `steppers` list of its `config.json` names.
The e2e-tests [package.json](../e2e-tests/package.json) and [tests/config.json](../e2e-tests/tests/config.json) show both.

The following steps create a module that uses Haibun's abstract storage to check whether files exist.

`mkdir haibun-files-exist`

`npm init`

`npm i @haibun/core @haibun/domain-storage`

Configure the repository for TypeScript and tests.
The haibun-sarif repository shows one configuration.
Haibun's scaffolding creates one too.

Create a source file, such as `src/files-exist.ts`.

Extend the `AStepper` abstract class.
Add the stepper's options, steps and methods.

The source file looks like this:

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

Features can use the statements _file "README.md" exists_ and _missing file "missing.md"_ once the module compiles.
The module requires a storage implementation, such as `@haibun/storage-fs`.
The test project lists the implementation as a dependency in its `package.json`.
A test base names it in the `steppers` list of its `config.json`.
The `HAIBUN_O_FILESEXIST_STORAGE` environment variable names the storage stepper the module uses, such as `StorageFS`.
A base can load several storage implementations.
The variable selects one.

## gwta statements

A step declares its statement with `exact`, `match` (a regular expression) or `gwta`.
Prefer `gwta`.
Only a `gwta` pattern declares placeholders.
A placeholder takes a quoted literal, a variable or an environment variable.
A number or JSON text doesn't need quotes.
A feature line may start with Given, When, Then or And.
The resolver removes those words from the start of the line before it matches the line to a `gwta` or `exact` pattern.
It removes the leading words `should`, `the`, `it`, `I'm`, `I`, `am`, `an` and `a` too.

### Domain-driven placeholders

A placeholder has the form `{name[:domain]}`.

Examples:

- `{what}` → domain defaults to `string`.
- `{ms:number}` → domain is `number`. Its schema coerces and validates the value.
- `{target:${DOMAIN_PAGE_LOCATOR}}` → domain is `page-locator`.
- `{when:${DOMAIN_STATEMENT}}` → domain is `statement`. The value is a Haibun statement that must resolve to a step.

Each parsed placeholder holds a required `domain` field.
The parser assigns `string` to a placeholder that doesn't name a domain.

#### Built-in domains

Core registers these domains, among others:

- `string`: a string literal. It is the default domain.
- `text`: free text a person writes.
- `link`: a URI.
- `number`: a number. A value that isn't a finite number fails with `invalid number`.
- `date`: a `Date` read from an ISO timestamp, epoch milliseconds or a `Date`.
- `json`: a JSON value. The domain takes JSON text or a JSON value. Text that isn't JSON fails.
- `statement`: a nested step statement. It must resolve to a step.

`@haibun/web-playwright` registers `page-locator` for Playwright selectors such as `css=` or `text=`.

#### Domain registry

A stepper declares its domains in the `getConcerns` function of its `cycles`.
Each domain is a `TDomainDefinition` with its selectors, a Zod schema and a description.
The schema parses the domain's value in each form that a feature line, a variable or a call supplies.
It returns the value the step receives.
Parsing that value again returns the same value.
The schema's JSON Schema describes the form a call sends.
`fromJsonText` makes a composite domain's schema parse the domain's JSON text too:

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

A domain declares `coerce` only when its value depends on the step that receives it.
The `statement` domain declares one.
Its `coerce` resolves the statement's text to feature steps.
A domain that doesn't declare `coerce` coerces a value with its schema's `parse`.

#### Validation & errors

- Registration refuses a step whose parameter names a domain that the loaded steppers don't register. The error names the step, the parameter and the domain.
- A value that its parameter's domain refuses fails the step. The failure names the step, the parameter, the term and the schema's reason.
- `fromJsonText` refuses text that isn't JSON before the schema checks anything else. The refusal states the parser's reason and the text's first 120 characters.
- A `string` parameter takes a variable of any domain unchanged.
- A variable of another domain fills a parameter only when the variable's domain is primitive or the parameter's domain references the variable's domain. Any other variable fails the step. The failure names both domains.
- The resolver refuses a `{x:${DOMAIN_STATEMENT}}` placeholder whose text doesn't resolve to a step. The error message is `statement '<text>' invalid: <reason>`.

#### Authoring guidelines

- Name a placeholder's domain where the value has a meaning or needs validation: `{ms:number}`, not `{ms}`.
- Write a multi-word domain name in kebab-case, such as `page-locator`.
- Keep each domain to one kind of value.
- Put behaviour in step actions, not in schemas.
- Add a domain for a new data shape, so that steps don't each parse it.

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
			/* each holds the feature steps its statement resolves to */
		},
	},
};
```

## Example modules and tests

[haibun sarif](https://github.com/withhaibun/haibun-sarif) is an example module outside the haibun repository.

This repository's [e2e-tests](../e2e-tests) folder contains example integration tests.
`npm run test:tests` runs the `tests` base from that folder.
`npx haibun-cli tests xss` runs the base's features whose paths match `xss`.
The e2e-tests [test server stepper](../e2e-tests/src/test-server.ts) adds routes to a running web server.
