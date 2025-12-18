import { TSpecl, TWorld, TRuntime, TModuleOptions, CStepper, TFeatureStep } from '../defs.js';
import { TNotOKActionResult, TOKActionResult, OK, TSeqPath, TDebugSignal } from '../../schema/protocol.js';
import { TAnyFixme } from '../fixme.js';
import { IHasOptions, AStepper } from '../astepper.js';
import { TTag } from '../ttag.js';
import { TArtifactEvent } from '../../schema/protocol.js';
export * from './actualURI.js';

// Helper to get term from stepValuesMap with null safety
export function getStepTerm(featureStep: TFeatureStep, key: string): string | undefined {
	return featureStep?.action?.stepValuesMap?.[key]?.term;
}

// Checks if an unquoted term should be treated as a string literal
// A term is literal if it:
// - doesn't start with [a-zA-Z_], OR
// - contains characters outside [a-zA-Z0-9_ ], OR
// - contains / (paths like /count, MIME types like application/json)
export function isLiteralValue(term: string): boolean {
	return !/^[a-zA-Z_]/.test(term) || /[^a-zA-Z0-9_ ]/.test(term);
}

type TClass = { new <T>(...args: unknown[]): T };

export const basesFrom = (s): string[] => s?.split(',').map((b) => b.trim());

import nodeFS from 'fs';
import path from 'path';

/**
 * Resolve and import a stepper module.
 * Supports:
 * - Package names: @haibun/monitor-tui → resolves main from package.json
 * - Explicit paths: @haibun/monitor-tui/build/index → imports directly
 * - Relative paths: ./build-local/test-server → imports from cwd
 */
export async function use(module: string): Promise<TClass> {
	try {
		const resolvedPath = resolveModulePath(module);
		const re: object = (await import(resolvedPath)).default;
		checkModuleIsClass(re, module);
		return <TClass>re;
	} catch (e) {
		console.error('failed including', module);
		throw e;
	}
}

function resolveModulePath(module: string): string {
	// Check if this is a directory with package.json (package reference)
	if (nodeFS.existsSync(module)) {
		const pkgPath = path.join(module, 'package.json');
		if (nodeFS.existsSync(pkgPath)) {
			const pkg = JSON.parse(nodeFS.readFileSync(pkgPath, 'utf-8'));
			const main = pkg.main || 'index.js';
			return path.join(module, main);
		}
		// Directory exists but no package.json, try as file
		if (nodeFS.existsSync(`${module}.js`)) {
			return `${module}.js`;
		}
		// Maybe it's a directory with index.js
		const indexPath = path.join(module, 'index.js');
		if (nodeFS.existsSync(indexPath)) {
			return indexPath;
		}
	}
	// Default: append .js extension
	return `${module}.js`;
}

export function checkModuleIsClass(re: object, module: string) {
	const type = re?.toString().replace(/^ /g, '').split('\n')[0].replace(/\s.*/, '');

	if (type !== 'class') {
		throw Error(`"${module}" is ${type}, not a class`);
	}
}

export function actionNotOK(message: string, w?: { artifact?: TArtifactEvent, controlSignal?: TDebugSignal, topics?: Record<string, unknown> }): TNotOKActionResult {
	const { artifact, controlSignal, topics } = w || {};
	return {
		ok: false,
		message,
		artifact,
		controlSignal,
		topics
	};
}
export function randomString() {
	return ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_');
}

export function actionOK(w?: { artifact?: TArtifactEvent, controlSignal?: TDebugSignal, topics?: Record<string, unknown> }): TOKActionResult {
	const { artifact, controlSignal, topics } = w || {};
	return { ...OK, artifact, controlSignal, topics };
}

export function createSteppers(steppers: CStepper[]): AStepper[] {
	const allSteppers: AStepper[] = [];
	for (const S of steppers) {
		try {
			const stepper = new S();
			allSteppers.push(stepper);
		} catch (e) {
			console.error(`create ${S} failed`, e, S);
			throw e;
		}
	}
	return allSteppers;
}

export function getDefaultOptions(): TSpecl {
	return {
		steppers: ['variables-stepper'],
	};
}

export function getActionable(value: string) {
	return value.replace(/;;.*/, '').trim();
}

export function constructorName(stepper: AStepper) {
	// FIXME deal with vitest / esbuild keepNames nonsense
	return stepper.constructor.name.replace(/2$/, '');
}

export function describeSteppers(steppers: AStepper[]) {
	return steppers
		?.map((stepper) => {
			return `${constructorName(stepper)}: ${Object.keys(stepper?.steps).sort().join('|')}`;
		})
		.sort()
		.join('  \n');
}

// from https://stackoverflow.com/questions/1027224/how-can-i-test-if-a-letter-in-a-string-is-uppercase-or-lowercase-using-javascrip
export function isLowerCase(str: string) {
	return str.toLowerCase() && str != str.toUpperCase();
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function verifyExtraOptions(inExtraOptions: TModuleOptions, csteppers: CStepper[]) {
	const moduleOptions = { ...inExtraOptions };
	Object.entries(moduleOptions)?.map(([option, value]) => {
		const foundStepperParseResult = getStepperOptionValue(option, value, csteppers);

		if (foundStepperParseResult === undefined) {
			throw Error(`unmapped option ${option} from ${JSON.stringify(moduleOptions)}`);
		} else if (foundStepperParseResult.parseError) {
			throw Error(`wrong option ${option} from ${JSON.stringify(moduleOptions)}: ${foundStepperParseResult.parseError}`);
		}
		delete moduleOptions[option];
	});

	if (Object.keys(moduleOptions).length > 0) {
		throw Error(`no extra option for ${moduleOptions}`);
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
	return ['HAIBUN', 'O', constructorName(stepper).toUpperCase()].join('_') + '_';
}

/**
 * Find a stepper by option value from a list of steppers
 */
export function getStepperOptionValue(key: string, value: string, csteppers: CStepper[]) {
	for (const cstepper of csteppers) {
		const pre = getPre(cstepper.prototype);
		const name = key.replace(pre, '');
		const ao = new cstepper() as IHasOptions;

		if (key.startsWith(pre)) {
			if (!ao.options) {
				throw Error(`${cstepper.name} has no options`);
			}

			if (ao.options[name]) {
				return ao.options[name].parse(value);
			} else {
				throw Error(`${cstepper.name} has no option ${name}`);
			}
		}
	}
}

export function verifyRequiredOptions(steppers: CStepper[], options: TModuleOptions) {
	const requiredMissing: string[] = [];
	for (const Stepper of steppers) {
		const stepper = new Stepper();
		const ao = stepper as IHasOptions;

		for (const option in ao.options) {
			const optionName = getStepperOptionName(stepper, option);
			if (ao.options[option].required && !options[optionName]) {
				const { altSource } = ao.options[option];
				const altName = getStepperOptionName(stepper, altSource);
				if (!(altSource && options[altName])) {
					requiredMissing.push(optionName);
				}
			}
		}
	}
	if (requiredMissing.length) {
		throw Error(`missing required options ${requiredMissing}`);
	}
}

export function getStepperOptionName(stepper: AStepper | CStepper, name: string) {
	if ((stepper as CStepper)?.prototype) {
		return getPre((stepper as CStepper).prototype) + name;
	}
	return getPre(stepper as AStepper) + name;
}

export function getStepperOption(stepper: AStepper, name: string, moduleOptions: TModuleOptions) {
	const key = getStepperOptionName(stepper, name);
	return moduleOptions[key];
}

/**
 * Find a stepper by option value from a list of steppers
 */
export function maybeFindStepperFromOption<Type>(
	steppers: AStepper[],
	stepper: AStepper,
	moduleOptions: TModuleOptions,
	...optionNames: string[]
): Type {
	return doFindStepperFromOption(steppers, stepper, moduleOptions, true, ...optionNames);
}
export function findStepperFromOption<Type>(
	steppers: AStepper[],
	stepper: AStepper,
	moduleOptions: TModuleOptions,
	...optionNames: string[]
): Type {
	return doFindStepperFromOption(steppers, stepper, moduleOptions, false, ...optionNames);
}
function doFindStepperFromOption<Type>(
	steppers: AStepper[],
	stepper: AStepper,
	moduleOptions: TModuleOptions,
	optional: boolean,
	...optionNames: string[]
): Type {
	const val = optionNames.reduce<string | undefined>((v, n) => {
		const r = getStepperOption(stepper, n, moduleOptions);
		return v || r;
	}, undefined);

	if (!val && optional) {
		return undefined;
	}
	if (!val) {
		throw Error(stepperOptionNotFoundError(stepper, optionNames, moduleOptions));
	}
	return findStepper(steppers, val);
}

function stepperOptionNotFoundError(stepper: AStepper, optionNames: string[], moduleOptions: TModuleOptions): string {
	return `Cannot find single ${optionNames.map((o) => getStepperOptionName(stepper, o)).join(' or ')} in your ${constructorName(
		stepper
	)} options ${JSON.stringify(Object.keys(moduleOptions).filter((k) => k.startsWith(getPre(stepper))))}`;
}

/**
 * Find a stepper by option value, or fall back to finding a single stepper of the given kind.
 * If no stepper-level option is defined, returns any single stepper matching the first optionName as kind.
 * Throws if multiple steppers match the kind and no option is specified.
 */
export function findStepperFromOptionOrKind<Type>(
	steppers: AStepper[],
	stepper: AStepper,
	moduleOptions: TModuleOptions,
	...optionNames: string[]
): Type {
	// First, try to find via option
	const val = optionNames.reduce<string | undefined>((v, n) => {
		const r = getStepperOption(stepper, n, moduleOptions);
		return v || r;
	}, undefined);

	if (val) {
		return findStepper(steppers, val);
	}

	// Fall back: find any single stepper of the given kind
	const kind = optionNames[0];
	const matchingSteppers = steppers.filter((s) => s.kind === kind);

	if (matchingSteppers.length === 0) {
		throw Error(
			stepperOptionNotFoundError(stepper, optionNames, moduleOptions) +
			` and no stepper of kind ${kind} found`
		);
	}

	if (matchingSteppers.length > 1) {
		throw Error(
			`Multiple steppers of kind ${kind} found: ${matchingSteppers.map((s) => constructorName(s)).join(', ')}. ` +
			`Please specify which one to use via ${getStepperOptionName(stepper, optionNames[0])}`
		);
	}

	return matchingSteppers[0] as Type;
}

export function findStepper<Type>(steppers: AStepper[], name: string): Type {
	const stepper = <Type>(steppers.find((s) => constructorName(s) === name) as TAnyFixme);
	if (!stepper) {
		// FIXME does not cascade
		throw Error(
			`Cannot find stepper ${name} from ${JSON.stringify(
				steppers.map((s) => constructorName(s)),
				null,
				2
			)} `
		);
	}
	return stepper;
}

export function getFromRuntime<Type>(runtime: TRuntime, name: string): Type {
	return runtime[name] as Type;
}

export const descTag = (tag: TTag) => ` @${tag.sequence}`;
export const isFirstTag = (tag: TTag) => tag.sequence === 0;

export const intOrError = (val: string) => {
	if (val.match(/[^\d+]/)) {
		return { parseError: `${val} is not an integer` };
	}
	return { result: parseInt(val, 10) };
};

export const boolOrError = (val: string) => {
	if (val !== 'false' && val !== 'true') {
		return { parseError: `${val} is not true or false` };
	}
	return { result: val === 'true' };
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
	return typeof e === 'object' && e !== null && 'message' in e && typeof (e as Record<string, unknown>).message === 'string'
		? (e as Error)
		: new Error(e as TAnyFixme);
}

export function dePolite(s: string) {
	return s.replace(/^((given|when|then|and|should|the|it|I'm|I|am|an|a) )*/i, '');
}

export function shortenURI(uri: string) {
	const shortURI = uri.startsWith('https://') ? uri.replace('https://', '') : uri;
	return shortURI.length < 32 ? shortURI : shortURI.substring(0, 26) + '...' + shortURI.substring(uri.length - 6);
}

export function formattedSteppers(steppers: AStepper[]) {
	const a = steppers.reduce((acc, o) => {
		return {
			...acc,
			[(o as TAnyFixme).constructor.name]: Object.entries(o.steps).map(
				([stepperName, stepperMatch]) => stepperName + ': ' + (stepperMatch.gwta || stepperMatch.exact || stepperMatch.match)
			),
		};
	}, {} as { [name: string]: { desc: string } });
	return a;
}

export const formatCurrentSection = (runtime: TRuntime) => [runtime.feature, runtime.scenario].filter(s => !!s).join('>');

export const formatCurrentSeqPath = (seqPath: TSeqPath) => '[' + seqPath.join('.') + ']';
