import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, TStepValueValue, Origin } from './defs.js';

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs; // no variables for this step

	for (const [name, stepVal] of Object.entries(featureStep.action.stepValuesMap)) {
		let runtimeValue: TStepValueValue;

		if (stepVal.origin === Origin.statement) {
			runtimeValue = stepVal.label;
		} else if (stepVal.origin === Origin.env) {
			runtimeValue = world.options.envVariables[stepVal.label]; // might be undefined
		} else if (stepVal.origin === Origin.var) {
			runtimeValue = world.shared.get(stepVal.label); // might be undefined
		} else if (stepVal.origin === Origin.fallthrough) {
			runtimeValue = world.options.envVariables[stepVal.label] ?? world.shared.get(stepVal.label) ?? stepVal.label;
		} else if (stepVal.origin === Origin.credential) {
			runtimeValue = stepVal.label;
		} else if (stepVal.origin === Origin.quoted) {
			runtimeValue = stepVal.label;
		} else {
			throw new Error(`Unsupported origin type: ${stepVal.origin}`);
		}
		if (runtimeValue === undefined) {
			continue;
		}

		const actionVal = world.shared.get(stepVal.label);
		if (actionVal !== undefined) {
			const storedEntry = world.shared.all()[stepVal.label];
			console.log('y🤑', JSON.stringify(storedEntry, null, 2));
			stepVal.domain = storedEntry.domain;
		} else {
		console.log('a🤑ctionVal', {actionVal, stepVal}, world.shared.all());

		}
		// Resolve domain for coercion
		let domainToUse = stepVal.domain;
		if (stepVal.origin === Origin.var || stepVal.origin === Origin.fallthrough) {
			const storedEntry = world.shared.all()[stepVal.label];
			if (storedEntry?.domain) {
				domainToUse = storedEntry.domain;
			}
		}

		let coerced: TStepValueValue;

		const isUnion = stepVal.domain.includes('|');
		const actionDomain = isUnion ? stepVal.domain.split('|').map(d => d.trim()).sort() : [domainToUse];

		// Common domain existence check
		const availableDomains = Object.keys(world.domains).sort();

		if (isUnion) {
			// If we have a resolved domain from stored variable, use it if it's in the union
			if (domainToUse !== stepVal.domain && actionDomain.includes(domainToUse)) {
				if (!world.domains[domainToUse]) {
					throw new Error(`No domain coercer found for resolved domain: "${domainToUse}". Available domains: ${availableDomains.join(', ')}. Check that the required stepper is included and has registered this domain.`);
				}
				coerced = await world.domains[domainToUse].coerce(runtimeValue as TStepValueValue, steppers);
			} else {
				// Look for union domain coercer using sorted domain key
				const sortedUnionKey = actionDomain.join(' | ');
				if (!world.domains[sortedUnionKey]) {
					throw new Error(`No domain coercer found for union domain: ${stepVal.domain} (sorted: ${sortedUnionKey}). Available domains: ${availableDomains.join(', ')}. Union domains require either a specific union coercer or variable resolution to a constituent domain.`);
				}
				// Pass the union domain itself as the resolved domain for literals
				const domainResolution = { setDomain: sortedUnionKey, actionDomain };
				coerced = await Promise.resolve(world.domains[sortedUnionKey].coerce(runtimeValue as TStepValueValue, steppers, domainResolution));
			}
		} else {
			// Single domain handling
			if (!world.domains[domainToUse]) {
				throw new Error(`No domain coercer found for domain: "${domainToUse}". Available domains: ${availableDomains.join(', ')}. Check that the required stepper is included and has registered this domain.`);
			}
			coerced = await Promise.resolve(world.domains[domainToUse].coerce(runtimeValue as TStepValueValue, steppers));
		}

		stepVal.value = coerced;
		stepArgs[name] = coerced;
	}

	return stepArgs;
}
