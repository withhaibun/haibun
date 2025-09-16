import { TOrigin, TStepValue, TStepValueValue } from "./defs.js";
import { DOMAIN_JSON } from "./domain-types.js";

export class FeatureVariables {
	private values: { [name: string]: TStepValue; };

	constructor(private context: string, initial?: { [name: string]: TStepValue; }) {
		this.values = initial || {};
	}
	clear() {
		this.values = {};
	}

	all() {
		return this.values;
	}

	toString() {
		return `context ${this.context} values ${this.values}`;
	}

	setJSON(label: string, value: object, origin?: TOrigin) {
		this.set({ label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin });
	}
	set(sv: TStepValue) {
		this.values[sv.label] = sv;
	}
	get(name: string): TStepValueValue | undefined {
		return this.values[name].value
	}
	getJSON<T>(name: string): T | undefined {
		if (!this.values[name]) return undefined;

		if (this.values[name].domain !== DOMAIN_JSON) throw Error(`${name} is ${this.values[name].domain}, not json`);
		return JSON.parse(this.values[name].value as string);
	}
}
