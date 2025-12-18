import { AStepper } from "./astepper.js";
import { isLiteralValue } from "./util/index.js";
import { TFeatureStep, TWorld } from './defs.js';
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue } from '../schema/protocol.js';
import { DOMAIN_JSON, DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";

export class FeatureVariables {
	private values: { [name: string]: TStepValue; };

	constructor(private world: TWorld, initial?: { [name: string]: TStepValue; }) {
		this.values = initial || {};
	}
	clear() {
		this.values = {};
	}

	all() {
		return { ...this.values };
	}

	toString() {
		return `context ${this.world.tag} values ${this.values}`;
	}

	setJSON(label: string, value: object, origin: TOrigin, source: TFeatureStep) {
		this.set({ term: label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin }, { in: source.in, seq: source.seqPath, when: `${source.action.stepperName}.${source.action.actionName}` });
	}
	setForStepper(stepper: string, sv: TStepValue, provenance: TProvenanceIdentifier) {
		return this._set({ ...sv, term: `${stepper}.${sv.term}` }, provenance);
	}
	unset(name: string) {
		delete this.values[name];
	}

	set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		if (sv.term.match(/.*\..*/)) {
			throw Error('non-stepper variables cannot use dots');
		}

		if (this.world.options.envVariables[sv.term]) {
			throw Error(`Cannot overwrite environment variable "${sv.term}"`);
		}

		if (this.values[sv.term]?.readonly) {
			throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		}

		return this._set(sv, provenance);
	}
	_set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey]
		if (domain === undefined) {
			throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		}
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		const existingProvenance: TProvenanceIdentifier[] = this.values[sv.term]?.provenance;
		const provenances = existingProvenance ? [...existingProvenance, provenance] : [provenance];
		this.values[sv.term] = {
			...normalized,
			provenance: provenances
		};
	}
	get<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;
		const domainKey = normalizeDomainKey(this.values[name].domain);
		const domain = this.world.domains[domainKey];
		if (!domain) {
			throw Error(`Cannot read variable "${name}": unknown domain "${this.values[name].domain}"`);
		}
		const ret = <T>domain.coerce({ ...this.values[name], domain: domainKey });
		return ret;
	}
	getJSON<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;

		if (this.values[name].domain !== DOMAIN_JSON) throw Error(`${name} is ${this.values[name].domain}, not json`);
		return JSON.parse(this.values[name].value as string);
	}

	/**
	 * Resolves a variable and its domain based on its actual origin. 
	 */
	resolveVariable(input: { term: string; origin: TOrigin; domain?: string }, featureStep?: TFeatureStep, steppers?: AStepper[]): TStepValue {
		const resolved: Partial<TStepValue> = {
			term: input.term,
			value: undefined,
		};

		// Handle {varName} syntax - extract variable name from braces
		let lookupTerm = input.term;
		if (lookupTerm.startsWith('{') && lookupTerm.endsWith('}')) {
			lookupTerm = lookupTerm.slice(1, -1);
		}

		const storedEntry = this.values[lookupTerm];

		if (!input.origin || input.origin === Origin.statement) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = this.world.options.envVariables[lookupTerm]; // might be undefined
			resolved.domain = DOMAIN_STRING;
		} else if (input.origin === Origin.var) {
			if (storedEntry) {
				resolved.domain = storedEntry.domain;
				resolved.value = storedEntry.value;
				resolved.provenance = storedEntry.provenance;
			}
		} else if (input.origin === Origin.defined) {
			if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
				resolved.value = featureStep.runtimeArgs[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.var;
			} else if (this.world.options.envVariables[lookupTerm]) {
				resolved.value = this.world.options.envVariables[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.env;
			} else if (storedEntry) {
				resolved.value = storedEntry.value;
				resolved.domain = storedEntry.domain;
				resolved.provenance = storedEntry.provenance;
				resolved.origin = Origin.var;
			} else if (isLiteralValue(input.term)) {
				// Fallback: treat unquoted terms that look like literals as string values
				resolved.value = input.term;
				resolved.domain = DOMAIN_STRING;
			}
			// Note: for {varName} syntax, storedEntry is looked up using lookupTerm (without braces)
			// so this naturally resolves quantifier-bound variables
		} else if (input.origin === Origin.quoted) {
			// Check if this is {varName} syntax - if so, resolve as variable
			if (input.term.startsWith('{') && input.term.endsWith('}') && !input.term.includes(':')) {
				if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
					resolved.value = featureStep.runtimeArgs[lookupTerm];
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else if (storedEntry) {
					resolved.value = storedEntry.value;
					resolved.domain = storedEntry.domain;
					resolved.provenance = storedEntry.provenance;
					resolved.origin = Origin.var;
				}
			} else {
				resolved.value = input.term.replace(/^"|"$/g, '');
				resolved.domain = DOMAIN_STRING;
			}
		} else {
			throw new Error(`Unsupported origin type: ${input.origin}`);
		}

		if (resolved.value !== undefined) {
			// Ensure domain is defined before coercion, fallback to string if undefined
			const domainKey = resolved.domain ?? DOMAIN_STRING;
			const domain = this.world.domains[domainKey];
			if (!domain) {
				throw new Error(`Cannot resolve variable "${input.term}": unknown domain "${domainKey}"`);
			}
			resolved.value = domain.coerce({ ...resolved as TStepValue, domain: domainKey }, featureStep, steppers);
			resolved.domain = domainKey;
		}

		return resolved as TStepValue;
	}
	getDomainValues(domainName: string): { values: unknown[], error?: string } {
		const domainKey = normalizeDomainKey(domainName);
		const domainDef = this.world.domains[domainKey];

		if (!domainDef) {
			return { values: [], error: `Domain "${domainName}" is not defined` };
		}

		if (Array.isArray(domainDef.values) && domainDef.values.length > 0) {
			return { values: domainDef.values };
		}

		const allVars = this.all();
		const memberValues = Object.values(allVars)
			.filter(v => v.domain && normalizeDomainKey(v.domain) === domainKey)
			.map(v => v.value);

		return { values: memberValues };
	}
}
