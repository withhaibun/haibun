import { AStepper } from './astepper.js';
import { TFeatureStep, TStepArgs, TWorld, TStepValueValue, Origin } from './defs.js';
import { DOMAIN_STRING } from './domain-types.js';

export async function populateActionArgs(featureStep: TFeatureStep, world: TWorld, steppers: AStepper[]): Promise<TStepArgs> {
	const stepArgs: TStepArgs = {};
	if (!featureStep?.action?.stepValuesMap) return stepArgs; // no variables for this step

	for (const [name, actionVal] of Object.entries(featureStep.action.stepValuesMap)) {
		let runtimeValue: TStepValueValue;

		if (actionVal.origin === Origin.statement) {
			runtimeValue = actionVal.label;
		} else if (actionVal.origin === Origin.env) {
			runtimeValue = world.options.envVariables[actionVal.label]; // might be undefined
		} else if (actionVal.origin === Origin.var) {
			runtimeValue = world.shared.get(actionVal.label); // might be undefined
		} else if (actionVal.origin === Origin.fallthrough) {
			runtimeValue = world.options.envVariables[actionVal.label] ?? world.shared.get(actionVal.label) ?? actionVal.label;
		} else if (actionVal.origin === Origin.credential) {
			runtimeValue = actionVal.label;
		} else if (actionVal.origin === Origin.quoted) {
			runtimeValue = actionVal.label;
		} else {
			throw new Error(`Unsupported origin type: ${actionVal.origin}`);
		}
		if (runtimeValue === undefined) {
			continue;
		}

		// Resolve domain for coercion
		let domainToUse = actionVal.domain;
		if (actionVal.origin === Origin.var || actionVal.origin === Origin.fallthrough) {
			const storedEntry = world.shared.all()[actionVal.label];
			if (storedEntry?.domain) {
				domainToUse = storedEntry.domain;
			}
		}

		const isUnion = actionVal.domain.includes('|');
		const actionDomain = isUnion ? actionVal.domain.split('|').map(d => d.trim()).sort() : [actionVal.domain];

		if (isUnion && (actionVal.origin === Origin.quoted)) {
			if (actionDomain.includes(DOMAIN_STRING)) {
				domainToUse = DOMAIN_STRING;
			}
		}

		if (domainToUse !== actionVal.domain && !actionDomain.includes(domainToUse)) {
			const declaredDomains = isUnion ? actionVal.domain : `"${actionVal.domain}"`;
			throw new Error(`For "${featureStep.in}": Domain mismatch: variable "${actionVal.label}" has domain "${domainToUse}" but action parameter expects ${declaredDomains}. The variable's domain must match the action's declared domain or be included in a union domain.`);
		}

		let coerced: TStepValueValue;
		const availableDomains = Object.keys(world.domains).sort();

		if (isUnion) {
			console.log('🤑', JSON.stringify(actionVal, null, 2));
			if (domainToUse !== actionVal.domain && actionDomain.includes(domainToUse)) {
				if (!world.domains[domainToUse]) {
					throw new Error(`No domain coercer found for resolved domain: "${domainToUse}". Available domains: ${availableDomains.join(', ')}. Check that the required stepper is included and has registered this domain.`);
				}
				actionVal.domain = domainToUse;
				coerced = await world.domains[domainToUse].coerce(runtimeValue as TStepValueValue, steppers);
			} else {
				const sortedUnionKey = actionDomain.join(' | ');
				if (!world.domains[sortedUnionKey]) {
					throw new Error(`No domain coercer found for union domain: ${actionVal.domain} (sorted: ${sortedUnionKey}). Available domains: ${availableDomains.join(', ')}. Union domains require either a specific union coercer or variable resolution to a constituent domain.`);
				}
				const domainResolution = { setDomain: sortedUnionKey, actionDomain };
				coerced = await Promise.resolve(world.domains[sortedUnionKey].coerce(runtimeValue as TStepValueValue, steppers, domainResolution));
			}
		} else {
			if (!world.domains[domainToUse]) {
				throw new Error(`No domain coercer found for domain: "${domainToUse}". Available domains: ${availableDomains.join(', ')}. Check that the required stepper is included and has registered this domain.`);
			}
			coerced = await Promise.resolve(world.domains[domainToUse].coerce(runtimeValue as TStepValueValue, steppers));
		} actionVal.value = coerced;
		stepArgs[name] = coerced;
	}

	return stepArgs;
}
