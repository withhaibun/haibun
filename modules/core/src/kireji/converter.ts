import { AStepper } from "../lib/astepper.js";
import { Resolver } from "../phases/Resolver.js";
import { TActionExecutor, TCurriedAction, withAction } from "./withAction.js";

// A kireji feature: steps are either TActionExecutor functions or plain prose strings.
type TkirejiFeature = {
	[key: string]: (TActionExecutor<string> | string)[];
};

export type TBddWithLineMap = {
	content: string;
	lineMap: Map<number, number>; // bddLineNumber (1-indexed) -> stepIndex (0-indexed in source array)
};

/**
 * Convert a kireji feature object into a BDD-formatted string, executing functional steps to
 * obtain their GWTA and mapping each output line to its source step index.
 */
export const toBdd = (feature: TkirejiFeature): TBddWithLineMap => {
	let bddString = "";
	const lineMap = new Map<number, number>();
	let currentLine = 1; // 1-indexed line number in output

	for (const featureName in feature) {
		bddString += `Feature: ${featureName}\n`;
		currentLine++; // Feature line doesn't map to a step

		const steps = feature[featureName];

		for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
			const step = steps[stepIdx];
			// Handle both function executors and plain prose strings
			if (typeof step === "string") {
				bddString += `  ${step}\n`;
			} else {
				const { gwta } = step();
				bddString += `  ${gwta}\n`;
			}
			lineMap.set(currentLine, stepIdx);
			currentLine++;
		}
	}

	return { content: bddString, lineMap };
};

/**
 * Convert a BDD-formatted string back into a kireji feature object, resolving each step's prose
 * to a functional action with arguments via the provided steppers.
 */
export const fromBdd = (bdd: string, steppers: AStepper[]): Promise<TkirejiFeature> => {
	const lines = bdd.split("\n");
	const featureName = lines[0].replace("Feature: ", "").trim();
	const steps = lines
		.slice(1)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const resolver = new Resolver(steppers);
	const stepperActions = steppers.map((stepper) => withAction(stepper) as unknown as Record<string, TCurriedAction<string>>);

	const kirejiSteps = steps.map((step) => {
		const action = resolver.findSingleStepAction(step);
		const { actionName, stepValuesMap } = action;
		const args: { [key: string]: string } = {};
		if (stepValuesMap) {
			for (const key in stepValuesMap) {
				args[key] = stepValuesMap[key].term;
			}
		}

		const actionFunction = stepperActions.reduce<TCurriedAction<string> | undefined>((found, actions) => {
			return found ?? actions[actionName];
		}, undefined);

		if (!actionFunction) {
			throw new Error(`Action "${actionName}" not found in provided steppers.`);
		}
		return actionFunction(args);
	});

	return Promise.resolve({
		[featureName]: kirejiSteps,
	});
};
