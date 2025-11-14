import { AStepper, TStepperSteps } from '../lib/astepper.js';
import { namedInterpolation } from '../lib/namedVars.js';

type TStepWithGwta = TStepperSteps[keyof TStepperSteps] & { gwta: string };

const isStepWithGwta = (step: unknown): step is TStepWithGwta => {
	return typeof (step as Partial<TStepWithGwta>).gwta === 'string';
};

const interpolateGwta = (gwta: string, args: { [key: string]: string }): string => {
	let interpolated = gwta;

	// First, remove optional regex patterns like '( empty)?' from the gwta
	// These are used for matching but shouldn't appear in the final output
	interpolated = interpolated.replace(/\([^)]*\)\?/g, '');

	for (const key in args) {
		const placeholder = `{${key}}`;
		const placeholderWithDomain = new RegExp(`\\{${key}:[^}]+\\}`, 'g');
		interpolated = interpolated.replace(placeholderWithDomain, args[key]);
		interpolated = interpolated.replace(placeholder, args[key]);
	}
	return interpolated;
};

// --- Start of TypeScript Magic ---

// Strip optional regex patterns from gwta strings for type extraction
type TStripOptionalPatterns<S extends string> = S extends `${infer Before}(${string})?${infer After}`
	? TStripOptionalPatterns<`${Before}${After}`>
	: S;

type TPlaceholderEntries<S extends string> = TPlaceholderEntriesImpl<TStripOptionalPatterns<S>>;

type TPlaceholderEntriesImpl<S extends string> = S extends `${string}{${infer Placeholder}}${infer After}`
	? [...TPlaceholderEntry<Placeholder>, ...TPlaceholderEntriesImpl<After>]
	: [];

type TPlaceholderEntry<P extends string> = P extends `${infer Name}:${infer Domain}`
	? [[Name, Domain]]
	: [[P, undefined]];

type TNestedArgValue =
	| string
	| number
	| boolean
	| null
	| TActionExecutor<string>
	| TNestedArgValue[]
	| { [key: string]: TNestedArgValue };

type TPlaceholderValueType<Name extends string, Domain extends string | undefined> = Domain extends 'statement'
	? string | TActionExecutor<string>
	: Name extends 'statement'
	? string | TActionExecutor<string>
	: string;

type TPlaceholderDomain<Entries extends ReadonlyArray<[string, string | undefined]>, Name extends string> =
	Extract<Entries[number], [Name, string | undefined]> extends [Name, infer Domain]
	? Domain extends string | undefined
	? Domain
	: undefined
	: undefined;

type TArgsInputFromEntries<Entries extends ReadonlyArray<[string, string | undefined]>> = {
	[K in Entries[number][0]]: TPlaceholderValueType<K, TPlaceholderDomain<Entries, K>>;
};

type TArgsResolvedFromEntries<Entries extends ReadonlyArray<[string, string | undefined]>> = {
	[K in Entries[number][0]]: string;
};

type TActionArgsInput<S extends string> = TArgsInputFromEntries<TPlaceholderEntries<S>>;
type TActionArgsResolved<S extends string> = TArgsResolvedFromEntries<TPlaceholderEntries<S>>;

export type TActionExecutor<S extends string> = () => {
	actionName: string;
	args: TActionArgsResolved<S>;
	gwta: string;
};

export type TCurriedAction<S extends string> = (args: TActionArgsInput<S>) => TActionExecutor<S>;

// Kireji step: either a string (prose/step) or an action executor function
export type TKirejiStep = string | TActionExecutor<string>;

// Kireji export structure: keys are feature/background names, values are arrays of steps
export type TKirejiExport = {
	[featureName: string]: TKirejiStep[];
};

type TActionsFromStepper<S extends TStepperSteps> = {
	[K in keyof S]: S[K] extends { gwta: infer G }
	? G extends string
	? TCurriedAction<G>
	: never
	: never;
};

// --- End of TypeScript Magic ---


type TActionFactory = (args: Record<string, TNestedArgValue>) => TActionExecutor<string>;

const resolveArgValue = (value: TNestedArgValue): string => {
	if (value === null) {
		return 'null';
	}

	if (typeof value === 'function') {
		const executed = value();
		return executed.gwta;
	}

	if (Array.isArray(value)) {
		return value.map(resolveArgValue).join(' ');
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value).map(([key, nested]) => `${key}: ${resolveArgValue(nested)}`);
		return `{ ${entries.join(', ')} }`;
	}

	// Escape newlines in string values for BDD format
	return String(value).replace(/\n/g, '\\n');
};

// Map to typedSteps if available (e.g., ActivitiesStepper), otherwise use steps directly
type TStepMap<T extends AStepper> = T extends { typedSteps: infer U }
	? U extends TStepperSteps
	? U
	: T['steps']
	: T['steps'];

export const withAction = <T extends AStepper>(stepper: T): TActionsFromStepper<TStepMap<T>> => {
	const actions: Record<string, TActionFactory> = {};

	for (const actionName in stepper.steps) {
		const step = stepper.steps[actionName];

		if (isStepWithGwta(step)) {
			// Strip optional patterns before extracting placeholders to match type-level behavior
			const strippedGwta = step.gwta.replace(/\([^)]*\)\?/g, '');
			const { stepValuesMap } = namedInterpolation(strippedGwta);
			const argNames = stepValuesMap ? Object.keys(stepValuesMap) : [];

			actions[actionName] = (args: Record<string, TNestedArgValue>) => {
				// Re-introducing runtime validation for missing arguments.
				for (const name of argNames) {
					if (args[name] === undefined) {
						throw new Error(`Missing argument "${name}" for action "${actionName}"`);
					}
				}

				const normalizedArgs: Record<string, string> = {};

				for (const name of argNames) {
					normalizedArgs[name] = resolveArgValue(args[name]);
				}

				return () => ({
					actionName,
					args: normalizedArgs,
					gwta: interpolateGwta(step.gwta, normalizedArgs),
				});
			};
		}
	}

	return actions as TActionsFromStepper<TStepMap<T>>;
};
