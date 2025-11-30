import { TFeatureStep, TOrigin, TProvenanceIdentifier, TStepValue, TWorld } from "./defs.js";
import { DOMAIN_JSON, normalizeDomainKey } from "./domain-types.js";

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
		this.world.logger.debug(`Set variable "${normalized.term}" to "${normalized.value}" (domain ${normalized.domain}, origin ${normalized.origin})`);
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
}
