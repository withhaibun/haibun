import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, TStepValueValue, Origin } from './defs.js';

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const result: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return result;

	for (const [name, stepVal] of Object.entries(featureStep.action.stepValuesMap)) {
		let runtimeValue: unknown;
		let cameFromShared = false;
		if (stepVal.origin === Origin.statement) {
			runtimeValue = stepVal.label;
		} else if (stepVal.origin === Origin.env) {
			runtimeValue = world.options.envVariables[stepVal.label] ?? (() => { throw Error(`missing env variable ${stepVal.label}`); })();
		} else if (stepVal.origin === Origin.var) {
			// variable origin: prefer the stored shared value; if present, note it came from shared so
			// we can copy through its domain.
			const sharedVal = world.shared.get(stepVal.label);
			runtimeValue = sharedVal ?? (() => { throw Error(`missing variable '${stepVal.label}' for placeholder '${name}' in ${featureStep.path}`); })();
			if (sharedVal !== undefined) cameFromShared = true;
		} else if (stepVal.origin === Origin.fallthrough) {
			const sharedVal = world.shared.get(stepVal.label);
			if (world.options.envVariables[stepVal.label] !== undefined) {
				runtimeValue = world.options.envVariables[stepVal.label];
			} else if (sharedVal !== undefined) {
				runtimeValue = sharedVal;
				cameFromShared = true;
			} else {
				runtimeValue = stepVal.label;
			}
		} else {
			runtimeValue = stepVal.label;
		}

		// If the runtime value came from shared, and the shared store exposes the stored
		// entry's domain via shared.all(), copy that domain into the placeholder so the
		// domain declared on the placeholder carries through everywhere.
		if (cameFromShared && world.shared && typeof world.shared.all === 'function') {
			const all = world.shared.all();
			const entry = all && all[stepVal.label];
			if (entry && entry.domain) {
				stepVal.domain = entry.domain;
			}
		}

		const coerced = await Promise.resolve(world.domains[stepVal.domain].coerce(runtimeValue as TStepValueValue, steppers));

		stepVal.value = coerced;
		result[name] = coerced;
	}

	return result;
}
