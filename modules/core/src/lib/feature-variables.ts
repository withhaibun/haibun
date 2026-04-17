import { AStepper } from "./astepper.js";
import { isLiteralValue } from "./util/index.js";
import { parseDotPath, navigateValue } from "./util/dot-path.js";
import { TFeatureStep, TWorld } from "./defs.js";
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue } from "../schema/protocol.js";
import { DOMAIN_JSON, DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { QuadStore } from "./quad-store.js";
import { IQuadStore, TQuad, emitQuadObservation } from "./quad-types.js";

export const SHARED_GRAPH = "variables";
export const OBSERVATION_GRAPH = "observation";
export const OBSCURED_VALUE = "[o̴b̵s̵c̷u̶r̸e̵d̵]";

export class FeatureVariables {
	private store: IQuadStore;

	constructor(
		private world: TWorld,
		initial?: { [name: string]: TStepValue },
	) {
		this.store = new QuadStore();
		if (world.shared) {
			const prev = world.shared.getStore();
			if (prev instanceof QuadStore) prev.inheritBackingStores(this.store as QuadStore);
		}
		if (initial) {
			for (const [name, sv] of Object.entries(initial)) {
				void this.writeQuads(name, sv);
			}
		}
	}

	getStore(): IQuadStore {
		return this.store;
	}

	async all(): Promise<{ [name: string]: TStepValue }> {
		const quads = await this.store.query({ namedGraph: SHARED_GRAPH });
		const result: { [name: string]: TStepValue } = {};
		for (const q of quads) {
			const isSecretVar = q.properties?.secret === true || this.isSecret(q.subject);
			result[q.subject] = {
				term: q.subject,
				domain: q.predicate,
				value: isSecretVar ? OBSCURED_VALUE : q.object,
				origin: (q.properties?.origin as TOrigin) ?? Origin.var,
			};
		}
		return result;
	}

	toString() {
		return `tag ${this.world.tag}`;
	}

	async setJSON(label: string, value: object, origin: TOrigin, source: TFeatureStep) {
		await this.set(
			{ term: label, value: JSON.stringify(value), domain: DOMAIN_JSON, origin },
			{ in: source.in, seq: source.seqPath, when: `${source.action.stepperName}.${source.action.actionName}` },
		);
	}

	async setForStepper(stepper: string, sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph?: string) {
		return await this._set({ ...sv, term: `${stepper}.${sv.term}` }, provenance, namedGraph);
	}

	async unset(name: string) {
		await this.store.remove({ subject: name, namedGraph: SHARED_GRAPH });
	}

	async set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph?: string) {
		if (sv.term.match(/.*\..*/)) throw Error("non-stepper variables cannot use dots");
		if (this.world.options.envVariables[sv.term]) throw Error(`Cannot overwrite environment variable "${sv.term}"`);
		const existing = await this.getStoredEntry(sv.term);
		if (existing?.readonly) throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		return this._set(sv, provenance, namedGraph);
	}

	async _set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph: string = SHARED_GRAPH) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey];
		if (domain === undefined) throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		await this.writeQuads(sv.term, normalized, namedGraph, provenance);

		const timestamp = Date.now();
		emitQuadObservation(this.world.eventLogger, `quad-${timestamp}`, { subject: sv.term, predicate: domainKey, object: this.isSecret(sv.term) ? OBSCURED_VALUE : normalized.value, namedGraph, timestamp });
	}

	/** Look up a variable from store or dot-path. Shared by Origin.var, Origin.defined, Origin.quoted. */
	private async lookupVariable(term: string): Promise<Partial<TStepValue> | undefined> {
		const entry = await this.getStoredEntry(term);
		if (entry) return { value: entry.value, domain: entry.domain, origin: Origin.var, secret: entry.secret ?? this.isSecret(term) };
		if (term.includes(".")) {
			const dot = await this.resolveDotPath(term);
			if (dot.found) return { value: dot.value, domain: DOMAIN_STRING, origin: Origin.var };
		}
		return undefined;
	}

	async resolveVariable(
		input: { term: string; origin: TOrigin; domain?: string },
		featureStep?: TFeatureStep,
		steppers?: AStepper[],
		options: { secure: boolean } = { secure: false },
	): Promise<TStepValue> {
		const resolved: Partial<TStepValue> = { term: input.term, value: undefined };
		let lookupTerm = input.term;
		if (lookupTerm.startsWith("{") && lookupTerm.endsWith("}")) lookupTerm = lookupTerm.slice(1, -1);

		if (!input.origin || input.origin === Origin.statement) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = this.world.options.envVariables[lookupTerm];
			resolved.domain = DOMAIN_STRING;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			Object.assign(resolved, await this.lookupVariable(lookupTerm));
		} else if (input.origin === Origin.defined) {
			if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
				resolved.value = featureStep.runtimeArgs[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.var;
			} else if (this.world.options.envVariables[lookupTerm]) {
				resolved.value = this.world.options.envVariables[lookupTerm];
				resolved.domain = DOMAIN_STRING;
				resolved.origin = Origin.env;
				resolved.secret = this.isSecret(lookupTerm);
			} else {
				const found = await this.lookupVariable(lookupTerm);
				if (found) {
					Object.assign(resolved, found);
				} else if (isLiteralValue(input.term)) {
					resolved.value = input.term;
					resolved.domain = DOMAIN_STRING;
				}
			}
		} else if (input.origin === Origin.quoted) {
			if (input.term.startsWith("{") && input.term.endsWith("}") && !input.term.includes(":")) {
				if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
					resolved.value = featureStep.runtimeArgs[lookupTerm];
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else {
					Object.assign(resolved, await this.lookupVariable(lookupTerm));
				}
			} else {
				resolved.value = input.term.replace(/^"|"$/g, "");
				resolved.domain = input.domain ?? DOMAIN_STRING;
			}
		} else {
			throw new Error(`Unsupported origin type: ${input.origin}`);
		}

		if (resolved.value !== undefined) {
			const rawDomainKey = resolved.domain ?? DOMAIN_STRING;
			const parts = rawDomainKey
				.split(" | ")
				.map((s) => s.trim())
				.filter(Boolean)
				.sort();
			const sortedKey = parts.join(" | ");
			const isUnion = parts.length > 1;
			const domainKey = this.world.domains[sortedKey] ? sortedKey : isUnion ? DOMAIN_STRING : sortedKey;
			const domain = this.world.domains[domainKey];
			if (!domain) throw new Error(`Cannot resolve variable "${input.term}": unknown domain "${domainKey}"`);
			resolved.value = domain.coerce({ ...(resolved as TStepValue), domain: domainKey }, featureStep, steppers);
			resolved.domain = domainKey;
			const isSecretValue = resolved.secret === true || this.isSecret(lookupTerm);
			if (!options.secure && (resolved.origin === Origin.env || resolved.origin === Origin.var) && isSecretValue)
				resolved.value = OBSCURED_VALUE;
		}

		return resolved as TStepValue;
	}

	/** Reconstruct a stored variable entry from the quad's properties. */
	private async getStoredEntry(
		name: string,
	): Promise<{ value: unknown; domain: string; readonly?: boolean; secret?: boolean; origin?: TOrigin } | undefined> {
		const q = (await this.store.query({ subject: name, namedGraph: SHARED_GRAPH })).pop();
		if (!q) return undefined;
		const p = q.properties;
		return {
			value: q.object,
			domain: q.predicate,
			readonly: p?.readonly === true,
			secret: p?.secret === true,
			origin: p?.origin as TOrigin | undefined,
		};
	}

	private async resolveDotPath(lookupTerm: string): Promise<{ value: unknown; domain: string; found: boolean }> {
		const { baseName, pathSegments } = parseDotPath(lookupTerm);
		if (pathSegments.length === 0) return { value: undefined, domain: DOMAIN_STRING, found: false };
		const baseEntry = await this.getStoredEntry(baseName);
		if (!baseEntry) return { value: undefined, domain: DOMAIN_STRING, found: false };
		let baseValue = baseEntry.value;
		if (typeof baseValue === "string") {
			try {
				baseValue = JSON.parse(baseValue);
			} catch {
				return { value: undefined, domain: DOMAIN_STRING, found: false };
			}
		}
		const result = navigateValue(baseValue, pathSegments);
		return { ...result, domain: baseEntry.domain ?? DOMAIN_STRING };
	}

	async getDomainValues(domainName: string): Promise<{ values: unknown[]; error?: string }> {
		const domainKey = normalizeDomainKey(domainName);
		const domainDef = this.world.domains[domainKey];
		if (!domainDef) return { values: [], error: `Domain "${domainName}" is not defined` };
		if (Array.isArray(domainDef.values) && domainDef.values.length > 0) return { values: domainDef.values };
		const allVars = await this.all();
		const memberValues = Object.values(allVars)
			.filter((v) => v.domain && normalizeDomainKey(v.domain) === domainKey)
			.map((v) => v.value);
		return { values: memberValues };
	}

	async get(term: string, secure: boolean = false) {
		return (await this.resolveVariable({ term, origin: Origin.defined }, undefined, undefined, { secure })).value;
	}

	async allQuads(): Promise<TQuad[]> {
		return await this.store.all();
	}

	isSecret(name: string): boolean {
		return /(password|secret)/i.test(name);
	}

	async getSecrets(): Promise<{ [name: string]: string }> {
		const secrets: { [name: string]: string } = {};
		for (const [key, value] of Object.entries(this.world.options.envVariables)) {
			if (this.isSecret(key)) secrets[key] = String(value);
		}
		// Query raw quads to get unmasked values for secret detection
		const quads = await this.store.query({ namedGraph: SHARED_GRAPH });
		for (const q of quads) {
			if (q.properties?.secret === true || this.isSecret(q.subject)) secrets[q.subject] = String(q.object);
		}
		return secrets;
	}

	private async writeQuads(
		name: string,
		sv: TStepValue,
		namedGraph: string = SHARED_GRAPH,
		provenance?: TProvenanceIdentifier,
	): Promise<void> {
		const domainKey = normalizeDomainKey(sv.domain);
		const properties: Record<string, unknown> = {};
		if (sv.origin) properties.origin = sv.origin;
		if (sv.readonly) properties.readonly = true;
		if (sv.secret || this.isSecret(name)) properties.secret = true;
		if (provenance) {
			const existing = await this.store.query({ subject: name, namedGraph });
			const prev = existing.pop()?.properties?.provenance;
			properties.provenance = Array.isArray(prev) ? [...prev, provenance.seq] : [provenance.seq];
		}
		await this.store.set(name, domainKey, sv.value, namedGraph, Object.keys(properties).length > 0 ? properties : undefined);
	}
}
