import { z } from "zod";
import type { TSpecl } from "../actuality/domains/execution.js";
import type { TWorld, TRuntime, TModuleOptions } from "../actuality/domains/world.js";
import { TActionResult, OK, TDebugSignal, MODULE_OPTION_PREFIX } from "../../schema/protocol.js";
import { IHasOptions, AStepper, CStepper, TFeatureStep } from "../steps/domains/stepper.js";
import { TArtifactEvent, type TJsonArtifact } from "../../schema/protocol.js";
import type { TRemedy } from "../transport/ports.js";

/** Returns `s` where it fits in `max` characters. Otherwise returns its first `max - 1` characters and an ellipsis.
 *  Callers truncate with this function so each truncation has the same form. */
export function ellipsize(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

/** Returns the term of the value at `key` in the step's stepValuesMap. Returns undefined where stepValuesMap doesn't contain `key`. */
export function getStepTerm(featureStep: TFeatureStep, key: string): string | undefined {
	return featureStep?.action?.stepValuesMap?.[key]?.term;
}

export const basesFrom = (s: string | undefined): string[] => (s === undefined ? [] : s.split(",").map((b) => b.trim()));

export function actionNotOK(errorMessage: string, w?: { artifact?: TArtifactEvent; controlSignal?: TDebugSignal; remedy?: TRemedy }): TActionResult {
	const remedy = w?.remedy;
	// The parameter is typed string. A caller can pass a caught Error through a cast or an `any` value.
	// This converts an Error to its message and converts any other non-string with String().
	// TActionResult declares errorMessage as a string, so each reader of a step's result reads a string.
	const raw = errorMessage as unknown;
	const message = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
	return { ok: false, errorMessage: message, artifact: w?.artifact, controlSignal: w?.controlSignal, ...(remedy === undefined ? {} : { remedy }) };
}
export function actionOK(w?: { artifact?: TArtifactEvent; controlSignal?: TDebugSignal }): TActionResult {
	return { ...OK, artifact: w?.artifact, controlSignal: w?.controlSignal };
}

export function actionOKWithProducts(products: Record<string, unknown>, w?: { artifact?: TArtifactEvent; controlSignal?: TDebugSignal }): TActionResult {
	return { ok: true, products, artifact: w?.artifact, controlSignal: w?.controlSignal };
}

let artifactCounter = 0;
export function jsonArtifact(json: Record<string, unknown>): TJsonArtifact {
	return { kind: "artifact", artifactType: "json", id: `json-${++artifactCounter}`, timestamp: Date.now(), source: "haibun", level: "info", json, mimetype: "application/json" };
}

export function createSteppers(steppers: CStepper[]): AStepper[] {
	const allSteppers: AStepper[] = [];
	for (const S of steppers) {
		try {
			const stepper = new S();
			checkNoPoliteStepPrefixes(stepper);
			allSteppers.push(stepper);
		} catch (e) {
			console.error(`create ${S} failed`, e, S);
			throw e;
		}
	}
	return allSteppers;
}

/** Throws where a step's gwta or exact pattern starts with a prefix that dePolite removes. The resolver applies dePolite to each
 *  feature line and not to step patterns, so such a pattern doesn't match a feature line. The resolver then throws "doesn't match
 *  a step" and doesn't state the cause. The error at stepper creation names the step and the prefix to remove. */
export function checkNoPoliteStepPrefixes(stepper: AStepper): void {
	for (const [name, def] of Object.entries(stepper.steps)) {
		const pattern = def.gwta ?? def.exact;
		if (pattern === undefined) continue;
		const curt = dePolite(pattern);
		if (curt !== pattern) {
			throw Error(
				`${constructorName(stepper)}.${name}: step pattern "${pattern}" starts with the polite prefix "${pattern.slice(0, pattern.length - curt.length).trim()}". dePolite removes that prefix from each feature line, so the pattern could never match. Start the pattern at "${curt}".`,
			);
		}
	}
}

export function getDefaultOptions(): TSpecl {
	return { steppers: ["variables-stepper"] };
}

export function getActionable(value: string) {
	return value.replace(/;;.*/, "").trim();
}

export function constructorName(stepper: AStepper) {
	// Removes the trailing "2" that vitest/esbuild keepNames appends to class names.
	return stepper.constructor.name.replace(/2$/, "");
}

// from https://stackoverflow.com/questions/1027224/how-can-i-test-if-a-letter-in-a-string-is-uppercase-or-lowercase-using-javascrip
export function isLowerCase(str: string) {
	return str.toLowerCase() && str !== str.toUpperCase();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Returns a diagnostic string for a thrown value. The string for a ZodError lists each issue with its path. The string for an Error contains its
 *  message, its code where set and its cause chain. The string for another value is String(value). */
export function errorDetail(err: unknown): string {
	if (err instanceof z.ZodError) return err.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
	if (!(err instanceof Error)) return String(err);
	const parts: string[] = [err.message];
	const code = (err as NodeJS.ErrnoException).code;
	if (code) parts.push(`code=${code}`);
	if (err.cause) parts.push(`cause: ${errorDetail(err.cause)}`);
	return parts.join("; ");
}

export function verifyExtraOptions(inExtraOptions: TModuleOptions, csteppers: CStepper[]) {
	const moduleOptions = { ...inExtraOptions };
	Object.entries(moduleOptions)?.map(([option, value]) => {
		const foundStepperParseResult = getStepperOptionValue(option, value, csteppers);

		if (foundStepperParseResult === undefined) {
			console.warn(`ignoring option ${option}: its prefix doesn't name a loaded stepper. Load that stepper or remove the option.`);
			delete moduleOptions[option];
			return;
		} else if (foundStepperParseResult.parseError) {
			throw Error(`the value of option ${option} in ${JSON.stringify(moduleOptions)} doesn't parse: ${foundStepperParseResult.parseError}. Correct the value.`);
		}
		delete moduleOptions[option];
	});

	if (Object.keys(moduleOptions).length > 0) {
		throw Error(`the loaded steppers don't declare the options ${JSON.stringify(moduleOptions)}. Remove them or load the steppers that declare them.`);
	}
	return;
}

export async function setStepperWorldsAndDomains(steppers: AStepper[], world: TWorld) {
	for (const stepper of steppers) {
		try {
			await stepper.setWorld(world, steppers);
		} catch (e) {
			console.error(`setStepperWorldsAndDomains for ${constructorName(stepper)} failed`, e);
			throw e;
		}
	}
}

export function getPre(stepper: AStepper) {
	return `${MODULE_OPTION_PREFIX}${constructorName(stepper).toUpperCase()}_`;
}

/**
 * Parses `value` with the option parser of the first stepper in `csteppers` whose option prefix starts `key`.
 * Returns undefined where `key` doesn't start with the option prefix of any stepper in `csteppers`. Throws where that stepper doesn't declare the option.
 */
export function getStepperOptionValue(key: string, value: string, csteppers: CStepper[]) {
	for (const cstepper of csteppers) {
		const pre = getPre(cstepper.prototype);
		const name = key.replace(pre, "");
		const ao = new cstepper() as IHasOptions;

		if (key.startsWith(pre)) {
			if (!ao.options) {
				throw Error(`${cstepper.name} doesn't declare options. Remove the options that start with its prefix.`);
			}

			if (ao.options[name]) {
				return ao.options[name].parse(value);
			} else {
				throw Error(`${cstepper.name} doesn't declare the option ${name}. Correct the option name or remove the option.`);
			}
		}
	}
}

export function verifyRequiredOptions(steppers: CStepper[], options: TModuleOptions) {
	const requiredMissing: string[] = [];
	for (const Stepper of steppers) {
		const stepper = new Stepper();
		const ao = stepper as IHasOptions;

		for (const [option, { required, altSource }] of ao.options === undefined ? [] : Object.entries(ao.options)) {
			const optionName = getStepperOptionName(stepper, option);
			if (required && !options[optionName] && !(altSource && options[getStepperOptionName(stepper, altSource)])) requiredMissing.push(optionName);
		}
	}
	if (requiredMissing.length) {
		throw Error(`the required options ${requiredMissing} aren't set. Set each one in the config or as an environment variable.`);
	}
}

export function getStepperOptionName(stepper: AStepper | CStepper, name: string) {
	if ((stepper as CStepper)?.prototype) {
		return getPre((stepper as CStepper).prototype) + name;
	}
	return getPre(stepper as AStepper) + name;
}

/**
 * Returns the environment names of the given steppers' options that declare `perProcess`.
 *
 * A process that starts another process removes these names from the child's environment. The child process then takes its own
 * value of each option. A listening port and an identity are such options. An option declares `perProcess` in its own definition,
 * so this function reads the definitions and doesn't list option names.
 */
export function perProcessOptionNames(steppers: AStepper[]): string[] {
	const names: string[] = [];
	for (const stepper of steppers) {
		const options = (stepper as AStepper & IHasOptions).options;
		if (!options) continue;
		for (const [name, option] of Object.entries(options)) if (option.perProcess) names.push(getStepperOptionName(stepper, name));
	}
	return names;
}

export function getStepperOption(stepper: AStepper, name: string, moduleOptions: TModuleOptions) {
	const key = getStepperOptionName(stepper, name);
	return moduleOptions[key];
}

export function findStepperFromOption<Type>(steppers: AStepper[], stepper: AStepper, moduleOptions: TModuleOptions, ...optionNames: string[]): Type {
	const val = optionNames.reduce<string | undefined>((v, n) => {
		const r = getStepperOption(stepper, n, moduleOptions);
		return v || r;
	}, undefined);

	if (!val) {
		throw Error(stepperOptionNotFoundError(stepper, optionNames, moduleOptions));
	}
	return findStepper(steppers, val);
}

function stepperOptionNotFoundError(stepper: AStepper, optionNames: string[], moduleOptions: TModuleOptions): string {
	return `option ${optionNames.map((o) => getStepperOptionName(stepper, o)).join(" or ")} isn't set in the ${constructorName(
		stepper,
	)} options ${JSON.stringify(Object.keys(moduleOptions).filter((k) => k.startsWith(getPre(stepper))))}`;
}

/**
 * Returns the stepper that the first set option of `optionNames` names.
 * Where the options aren't set, returns the one stepper whose kind equals the first option name.
 * Throws where the options aren't set and the loaded steppers include several steppers of that kind or don't include one.
 * Throws where the set option names a stepper that isn't loaded.
 */
export function findStepperFromOptionOrKind<Type>(steppers: AStepper[], stepper: AStepper, moduleOptions: TModuleOptions, ...optionNames: [string, ...string[]]): Type {
	const val = optionNames.reduce<string | undefined>((v, n) => {
		const r = getStepperOption(stepper, n, moduleOptions);
		return v || r;
	}, undefined);

	if (val) {
		return findStepper(steppers, val);
	}

	// The options aren't set, so this selects the one stepper whose kind equals the first option name.
	const kind = optionNames[0];
	const matchingSteppers = steppers.filter((s) => s.kind === kind);

	if (matchingSteppers.length === 0) {
		throw Error(stepperOptionNotFoundError(stepper, optionNames, moduleOptions) + `, and the loaded steppers don't include one of kind ${kind}. Set the option or load one.`);
	}

	if (matchingSteppers.length > 1) {
		throw Error(
			`Multiple steppers of kind ${kind} found: ${matchingSteppers.map((s) => constructorName(s)).join(", ")}. ` +
				`Please specify which one to use via ${getStepperOptionName(stepper, optionNames[0])}`,
		);
	}

	return matchingSteppers[0] as Type;
}

export function findStepper<Type>(steppers: AStepper[], name: string): Type {
	const stepper = steppers.find((s) => constructorName(s) === name) as Type | undefined;
	if (!stepper) {
		throw Error(
			`stepper ${name} isn't loaded. Load it or name one of the loaded steppers ${JSON.stringify(
				steppers.map((s) => constructorName(s)),
				null,
				2,
			)}.`,
		);
	}
	return stepper;
}

export function getFromRuntime<Type>(runtime: TRuntime, name: string): Type {
	return runtime[name] as Type;
}

export const shortenURI = (uri: string) => {
	const shortURI = uri.startsWith("https://") ? uri.replace("https://", "") : uri;
	return shortURI.length < 32 ? shortURI : shortURI.substring(0, 26) + "..." + shortURI.substring(uri.length - 6);
};

export function slugify(s: string) {
	return s
		.replace(/[^a-zA-Z0-9]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export const intOrError = (val: string) => {
	if (val.match(/[^\d+]/)) {
		return { parseError: `${val} is not an integer` };
	}
	return { result: parseInt(val, 10) };
};

export const boolOrError = (val: string) => {
	if (val !== "false" && val !== "true") {
		return { parseError: `${val} is not true or false` };
	}
	return { result: val === "true" };
};

export const stringOrError = (val: string) => {
	if (val === undefined || val === null) {
		return { parseError: `${val} is not defined` };
	}
	return { result: val };
};

export const optionOrError = (val: string, options: string[]) => {
	if (val === undefined || val === null || !options.includes(val)) {
		return { parseError: `"${val}" is not defined or not one of ${JSON.stringify(options)} ` };
	}
	return { result: val };
};

export function trying<TResult>(fun: () => void): Promise<Error | TResult> {
	return new Promise((resolve, reject) => {
		try {
			const res = <TResult>fun();
			return resolve(res);
		} catch (e: unknown) {
			// https://kentcdodds.com/blog/get-a-catch-block-error-message-with-typescript
			return reject(asError(e));
		}
	});
}

export function asError(e: unknown): Error {
	return typeof e === "object" && e !== null && "message" in e && typeof e.message === "string" ? (e as Error) : new Error(String(e));
}

export function dePolite(s: string) {
	return s.replace(/^((given|when|then|and|should|the|it|I'm|I|am|an|a) )*/i, "");
}

export function formattedSteppers(steppers: AStepper[]) {
	const a = steppers.reduce(
		(acc, o) => {
			const name = constructorName(o);
			const description = o.description || name;
			return {
				...acc,
				[name]: {
					description,
					steps: Object.entries(o.steps).map(([stepperName, stepperMatch]) => stepperName + ": " + (stepperMatch.gwta || stepperMatch.exact || stepperMatch.match)),
				},
			};
		},
		{} as { [name: string]: { description: string; steps: string[] } },
	);
	return a;
}

const TRUNCATE_AT = 78;
const MAX_TRUNCATE_DEPTH = 10;

/** Returns `s` where it fits in TRUNCATE_AT characters. Otherwise returns its first TRUNCATE_AT characters and `[+Nc]`. N is the number of removed characters. */
export function truncateForDisplay(s: string): string {
	if (s.length <= TRUNCATE_AT) return s;
	return `${s.slice(0, TRUNCATE_AT)}[+${s.length - TRUNCATE_AT}c]`;
}

/** Returns a copy of a value for logging. truncateForDisplay truncates each string in the copy. A value nested deeper than MAX_TRUNCATE_DEPTH becomes "[truncated at depth]". */
export function truncateForLog(obj: unknown, depth: number): unknown {
	if (depth > MAX_TRUNCATE_DEPTH) return "[truncated at depth]";
	if (typeof obj === "string") return truncateForDisplay(obj);
	if (obj === null || obj === undefined || typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map((item) => truncateForLog(item, depth + 1));
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		result[k] = truncateForLog(v, depth + 1);
	}
	return result;
}
