type TContextValue = string;

export class FeatureVariables {
	private values: { [name: string]: TContextValue; };

	constructor(private context: string, initial?: { [name: string]: TContextValue; }) {
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

	setJSON(name: string, value: object) {
		this.values[name] = JSON.stringify(value);
	}
	set(name: string, value: TContextValue) {
		this.values[name] = value;
	}
	get(name: string): string | undefined {
		return this.values[name];
	}
	getJSON<T>(name: string): T | undefined {
		return this.values[name] ? (JSON.parse(this.values[name]) as T) : undefined;
	}
}
