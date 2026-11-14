import { AStepper, TStepperSteps, type TPlaceholderDomain, type TPlaceholderName, type TRequiredTexts } from "../../lib/steps/domains/stepper.js";
import type { DOMAIN_STATEMENT } from "../../lib/domains/domains.js";
import { renderStepLine } from "../../lib/steps/derivations/named-vars.js";
import { phraseParts } from "../../lib/steps/domains/phrase.js";

type TStepWithGwta = TStepperSteps[keyof TStepperSteps] & { gwta: string };
type TStepWithExact = TStepperSteps[keyof TStepperSteps] & { exact: string };

const isStepWithGwta = (step: unknown): step is TStepWithGwta => {
	return typeof (step as Partial<TStepWithGwta>).gwta === "string";
};

const isStepWithExact = (step: unknown): step is TStepWithExact => {
	return typeof (step as Partial<TStepWithExact>).exact === "string";
};

type TNestedArgValue = string | number | boolean | null | TActionExecutor<string> | TNestedArgValue[] | { [key: string]: TNestedArgValue };

// A slot's input type matches what `resolveArgValue` accepts at runtime:
// strings (the common case), nested objects/arrays (encoded as JSON), and action
// executors (statement slots resolve to the executed step's gwta). Keeping the
// type in sync with the runtime, rather than narrowing to `string`, lets feature
// files pass JS literals (`{ did, name }`) for fields whose stepper takes a
// composite, without forcing manual `JSON.stringify` at every call site.
type TPlaceholderValueType<Name extends string, Domain extends string> = Domain extends typeof DOMAIN_STATEMENT
	? string | TActionExecutor<string>
	: Name extends "statement"
		? string | TActionExecutor<string>
		: TNestedArgValue;

/** The arguments a call of a step takes: each placeholder every line of its pattern states, by its name. */
type TActionArgsInput<S extends string> = { [I in TRequiredTexts<S> as TPlaceholderName<I>]: TPlaceholderValueType<TPlaceholderName<I>, TPlaceholderDomain<I>> };
/** The arguments of a call as its line states them: each as its text. */
type TActionArgsResolved<S extends string> = { [I in TRequiredTexts<S> as TPlaceholderName<I>]: string };

export type TActionExecutor<S extends string> = () => { actionName: string; args: TActionArgsResolved<S>; gwta: string };

export type TCurriedAction<S extends string> = (args: TActionArgsInput<S>) => TActionExecutor<S>;

// Kireji step: either a string (prose/step) or an action executor function
export type TKirejiStep = string | TActionExecutor<string>;

// Kireji export structure: keys are feature/background names, values are arrays of steps or a multi-line string
export type TKirejiExport = { [featureName: string]: TKirejiStep[] | string };

/** A step's pattern as `declareSteps` types it: its gwta or its exact line, which share the pattern's type. */
type TPatternOf<S> = S extends { gwta?: infer L } ? Exclude<L, undefined> : never;
/** The action of each step `declareSteps` declares with a literal pattern, by the step's name. A step whose pattern isn't a
 *  literal type, or that doesn't state a pattern, doesn't have one. */
type TActionsFromStepper<T extends AStepper> = {
	[K in keyof T["steps"]]: TPatternOf<T["steps"][K]> extends infer L extends string ? (string extends L ? never : TCurriedAction<L>) : never;
};

type TActionFactory = (args: Record<string, TNestedArgValue>) => TActionExecutor<string>;

const resolveArgValue = (value: TNestedArgValue): string => {
	if (value === null) {
		return "null";
	}

	if (typeof value === "function") {
		const executed = value();
		return executed.gwta;
	}

	if (Array.isArray(value)) {
		return value.map(resolveArgValue).join(" ");
	}

	// JSON, not haibun composite-literal form, Zod-validated step inputs expect JSON.
	if (typeof value === "object") return JSON.stringify(value);

	// Escape newlines in string values for BDD format
	return String(value).replace(/\n/g, "\\n");
};

/** Why a step action doesn't convert to text: it is a function, whose text would be its source rather than a step line. */
export const ACTION_WITHOUT_LINE_FORM =
	"a step action doesn't have a line form, so a template literal or a string conversion doesn't hold its line. Compose it with limitedTo({ count, statement }), or state its line directly";

/** Returns an action whose conversion to text throws, so an action interpolated into a feature's line fails as the feature is built. */
function withoutLineForm<S extends string>(action: TActionExecutor<S>): TActionExecutor<S> {
	const refused = () => {
		throw new Error(ACTION_WITHOUT_LINE_FORM);
	};
	return Object.defineProperties(action, { toString: { value: refused }, [Symbol.toPrimitive]: { value: refused } });
}

export const withAction = <T extends AStepper>(stepper: T): TActionsFromStepper<T> => stepActions(stepper) as TActionsFromStepper<T>;

/** The action of each of a stepper's steps that declares a gwta or an exact line, by the step's name. An exact line doesn't take
 *  arguments, so its action is called with `{}`, as a gwta without placeholders is. */
export const stepActions = (stepper: AStepper): Record<string, TActionFactory> => {
	const actions: Record<string, TActionFactory> = {};

	for (const actionName in stepper.steps) {
		const step = stepper.steps[actionName];

		if (isStepWithGwta(step)) {
			const argNames = phraseParts(step.gwta).map(({ name }) => name);

			actions[actionName] = (args: Record<string, TNestedArgValue>) => {
				const normalizedArgs: Record<string, string> = {};
				for (const name of argNames) {
					const value = args[name];
					if (value === undefined) throw new Error(`Missing argument "${name}" for action "${actionName}"`);
					normalizedArgs[name] = resolveArgValue(value);
				}

				return withoutLineForm(() => ({ actionName, args: normalizedArgs, gwta: renderStepLine(step.gwta, normalizedArgs) }));
			};
		} else if (isStepWithExact(step)) {
			actions[actionName] = () => withoutLineForm(() => ({ actionName, args: {}, gwta: step.exact }));
		}
	}

	return actions;
};
