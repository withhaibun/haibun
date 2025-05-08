import { TNotOKActionResult, TOKActionResult, TSpecl, TWorld, TRuntime, TModuleOptions, CStepper } from '../defs.js';
import { TAnyFixme } from '../fixme.js';
import { IHasOptions } from '../astepper.js';
import { AStepper } from '../astepper.js';
import { TTag } from '../ttag.js';
import { TArtifact, TMessageContext } from '../interfaces/logger.js';

type TClass = { new <T>(...args: unknown[]): T };

export const basesFrom = (s): string[] => s?.split(',').map((b) => b.trim());

// FIXME tired of wrestling with ts/import issues
export async function use(module: string): Promise<TClass> {
	try {
		const re: object = (await import(`${module}.js`)).default;
		checkModuleIsClass(re, module);
		return <TClass>re;
	} catch (e) {
		console.error('failed including', module);
		throw e;
	}
}

export function checkModuleIsClass(re: object, module: string) {
	// this is early morning code
	const type = re?.toString().replace(/^ /g, '').split('\n')[0].replace(/\s.*/, '');

	if (type !== 'class') {
		throw Error(`"${module}" is ${type}, not a class`);
	}
}

export function actionNotOK(message: string, w?: { messageContext?: TMessageContext, artifact?: TArtifact }): TNotOKActionResult {
	const { messageContext, artifact } = w || {};
	return {
		ok: false,
		message,
		messageContext,
		artifact
	};
}
export function randomString() {
	return ['rnd', Math.floor(Date.now() / 1000).toString(36), Math.floor(Math.random() * 1e8).toString(36)].join('_');
}

export function actionOK(w?: { messageContext?: TMessageContext, artifact?: TArtifact }): TOKActionResult {
	const { messageContext, artifact } = w || {};
	return { ok: true, messageContext, artifact };
}

export async function createSteppers(steppers: CStepper[]): Promise<AStepper[]> {
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
	return Promise.resolve(allSteppers);
}

export function getDefaultOptions(): TSpecl {
	return {
		steppers: ['vars'],
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

export async function verifyExtraOptions(inExtraOptions: TModuleOptions, csteppers: CStepper[]) {
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
	return Promise.resolve();
}

export async function setStepperWorlds(steppers: AStepper[], world: TWorld) {
	for (const stepper of steppers) {
		try {
			await stepper.setWorld(world, steppers);
		} catch (e) {
			console.error(`setWorldStepperOptions ${constructorName(stepper)} failed`, e);
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

export async function verifyRequiredOptions(steppers: CStepper[], options: TModuleOptions) {
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
	return Promise.resolve();
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
		throw Error(
			`Cannot find ${optionNames.map((o) => getStepperOptionName(stepper, o)).join(' or ')} in your ${constructorName(
				stepper
			)} options ${JSON.stringify(Object.keys(moduleOptions).filter((k) => k.startsWith(getPre(stepper))))}`
		);
	}
	return findStepper(steppers, val);
}

export function findStepper<Type>(steppers: AStepper[], name: string): Type {
	const stepper = <Type>(steppers.find((s) => constructorName(s) === name) as TAnyFixme);
	if (!stepper) {
		// FIXME does not cascade
		throw Error(
			`Cannot find ${name} from ${JSON.stringify(
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

export const getSerialTime = () => Date.now();

export function dePolite(s: string) {
	return s.replace(/^((given|when|then|and|should|the|it|I'm|I|am|an|a) )*/i, '');
}

export function shortenUserAgent(ua: string) {
	return ua.length < 32 ? ua : ua.substring(0, 26) + '...' + ua.substring(ua.length - 6);
}

export function shortenURI(uri: string) {
	const shortURI = uri.startsWith('https://') ? uri.replace('https://', '') : uri;
	return shortURI.length < 32 ? shortURI : shortURI.substring(0, 26) + '...' + shortURI.substring(uri.length - 6);

}
