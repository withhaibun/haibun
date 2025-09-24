import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, TStepValueValue, Origin } from './defs.js';

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const result: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return result;

	for (const [name, stepVal] of Object.entries(featureStep.action.stepValuesMap)) {
		let runtimeValue: unknown;

		if (stepVal.origin === Origin.statement) {
			runtimeValue = stepVal.label;
		} else if (stepVal.origin === Origin.env) {
			runtimeValue = world.options.envVariables[stepVal.label] ?? (() => { throw Error(`missing env variable ${stepVal.label}`); })();
		} else if (stepVal.origin === Origin.var) {
			const sharedVal = world.shared.get(stepVal.label);
			runtimeValue = sharedVal ?? (() => { throw Error(`missing variable '${stepVal.label}' for placeholder '${name}' in ${featureStep.path}`); })();
			// Preserve domain from stored variable
			if (sharedVal !== undefined) {
				const storedEntry = world.shared.all()[stepVal.label];
				if (storedEntry?.domain) {
					stepVal.domain = storedEntry.domain;
				}
			}
		} else if (stepVal.origin === Origin.fallthrough) {
			const sharedVal = world.shared.get(stepVal.label);
			runtimeValue = world.options.envVariables[stepVal.label] ?? sharedVal ?? stepVal.label;
			// Preserve domain from stored variable if it came from shared
			if (sharedVal !== undefined) {
				const storedEntry = world.shared.all()[stepVal.label];
				if (storedEntry?.domain) {
					stepVal.domain = storedEntry.domain;
				}
			}
		} else {
			runtimeValue = stepVal.label;
		}

		const coerced = await Promise.resolve(world.domains[stepVal.domain].coerce(runtimeValue as TStepValueValue, steppers));

		stepVal.value = coerced;
		result[name] = coerced;
	}

	return result;
}
