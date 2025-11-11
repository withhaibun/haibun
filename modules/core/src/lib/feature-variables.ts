import { TFeatureStep, TOrigin, TProvenanceIdentifier, TStepValue, TWorld } from "./defs.js";
import { DOMAIN_JSON } from "./domain-types.js";

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
	set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		if (sv.term.match(/.*\..*/)) {
			throw Error('non-stepper variables cannot use dots');
		}
		return this._set(sv, provenance);
	}
	_set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		const domain = this.world.domains[sv.domain]
		if (domain === undefined) {
			throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		}
		this.world.domains[sv.domain].coerce(sv);
		const existingProvenance: TProvenanceIdentifier[] = this.values[sv.term]?.provenance;
		const provenances = existingProvenance ? [...existingProvenance, provenance] : [provenance];
		this.values[sv.term] = {
			...sv,
			provenance: provenances
		};
		this.world.logger.debug(`Set variable "${sv.term}" to "${sv.value}" (domain ${sv.domain}, origin ${sv.origin})`);
	}
	get<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;
		const ret = <T>this.world.domains[this.values[name].domain].coerce(this.values[name]);
		return ret;
	}
	getJSON<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;

		if (this.values[name].domain !== DOMAIN_JSON) throw Error(`${name} is ${this.values[name].domain}, not json`);
		return JSON.parse(this.values[name].value as string);
	}
}
