import { TOrigin, TStepValue, TStepValueValue, TWorld } from "./defs.js";
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

	setJSON(label: string, value: object, origin?: TOrigin) {
		this.set({ term: label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin });
	}
	set(sv: TStepValue) {
		const domain = this.world.domains[sv.domain]
		if (domain === undefined) {
			throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		}
		this.world.domains[sv.domain].coerce(sv);
		this.values[sv.term] = sv;
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
