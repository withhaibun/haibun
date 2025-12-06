import { TWorld, Origin, TOrigin, TStepValue } from '../defs.js';
import { DOMAIN_STRING } from '../domain-types.js';

export function interpolate(text: string, world: TWorld): string {
	const result = text.replace(/\{([^}]+)\}/g, (match, key) => {
		const resolved = resolveVariable({ term: key, origin: Origin.fallthrough }, world);
		if (resolved.origin === Origin.fallthrough) {
			console.log('\nyDEBUG: ', match, key, '333', String(resolved.value));
			return match;
		} else {
			console.log('\nnDEBUG: ', match, key, '444', String(resolved.value));
		}
		return String(resolved.value);
	});

	return result;
}

export function resolveVariable(actionVal: Partial<TStepValue> & { term: string, origin: TOrigin }, world: TWorld) {
	const storedEntry = world.shared.all()[actionVal.term];
	if (actionVal.origin === Origin.statement) {
		actionVal.value = actionVal.term;
	} else if (actionVal.origin === Origin.env) {
		actionVal.value = world.options.envVariables[actionVal.term]; // might be undefined
		actionVal.domain = DOMAIN_STRING;
	} else if (actionVal.origin === Origin.var) {
		if (storedEntry) {
			actionVal.domain = storedEntry.domain;
			actionVal.value = storedEntry.value;
			actionVal.provenance = storedEntry.provenance;
		}
	} else if (actionVal.origin === Origin.fallthrough) {
		if (world.options.envVariables[actionVal.term]) {
			actionVal.value = world.options.envVariables[actionVal.term];
			actionVal.origin = Origin.env;
		} else if (storedEntry) {
			actionVal.value = storedEntry.value;
			actionVal.domain = storedEntry.domain;
			actionVal.provenance = storedEntry.provenance;
			actionVal.origin = Origin.var;
		} else {
			actionVal.value = actionVal.term;
			actionVal.domain = DOMAIN_STRING;
		}
	} else if (actionVal.origin === Origin.quoted) {
		actionVal.value = actionVal.term;
		actionVal.domain = DOMAIN_STRING;
	} else {
		throw new Error(`Unsupported origin type: ${actionVal.origin}`);
	}
	return actionVal;
}
