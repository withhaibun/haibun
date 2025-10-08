import { TFeatureStep, TOrigin, TProvenanceIdentifier, TStepValue, TStepValueValue, TWorld } from "./defs.js";
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
		return this.values;
	}

	toString() {
		return `context ${this.world.tag} values ${this.values}`;
	}

	setJSON(label: string, value: object, origin: TOrigin, source: TFeatureStep) {
		this.set({ term: label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin }, { in: source.in, seq: source.seqPath, when: `${source.action.stepperName}.${source.action.actionName}` });
	}
	set(sv: TStepValue, provenance: TProvenanceIdentifier) {
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
	get(name: string): TStepValueValue | undefined {
		if (!this.values[name]) return undefined;
		return this.values[name].value;
	}
	getJSON<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;

		if (this.values[name].domain !== DOMAIN_JSON) throw Error(`${name} is ${this.values[name].domain}, not json`);
		return JSON.parse(this.values[name].value as string);
	}
}
