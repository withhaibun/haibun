import { TTag } from './defs.js';

export class Context {
	values: { [name: string]: any };

	constructor(private context: string, initial?: { [name: string]: string }) {
		this.values = initial || {};
	}

	toString() {
		return `context ${this.context} values ${this.values}`;
	}

	set(name: string, value: string | boolean | object) {
		this.values[name] = value;
	}
	setOnly(name: string, value: string | boolean | object) {
		if (this.get(name)) {
			throw Error(`${name} is already set to ${this.values[name]}`);
		}
		this.set(name, value);
	}
	get(name: string) {
		return this.values[name];
	}
	concat(name: string, value: any) {
		const t = this.values[name] || [];
		this.values[name] = [...t, value];
	}
	unset(name: string) {
		delete this.values[name];
	}
}

export class WorldContext extends Context {
	constructor(tag: TTag, initial?: { [name: string]: string }) {
		super(`world ${JSON.stringify(tag)}`, initial);
	}
}
