import { AStepper } from "./astepper.js";
import { isLiteralValue } from "./util/index.js";
import { parseDotPath, navigateValue } from "./util/dot-path.js";
import { TFeatureStep, TWorld } from "./defs.js";
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue, THaibunEvent } from "../schema/protocol.js";
import { DOMAIN_JSON, DOMAIN_STRING, normalizeDomainKey } from "./domain-types.js";
import { QuadStore } from "./quad-store.js";
import { IQuadStore, TQuad } from "./quad-types.js";

export const SHARED_GRAPH = "variables";
export const META_GRAPH = "meta";
export const OBSERVATION_GRAPH = "observation";
export const OBSCURED_VALUE = "[o̴b̵s̵c̷u̶r̸e̵d̵]";

export class FeatureVariables {
	private store: IQuadStore;

	constructor(
		private world: TWorld,
		initial?: { [name: string]: TStepValue },
	) {
		this.store = new QuadStore();
		if (initial) {
			for (const [name, sv] of Object.entries(initial)) {
				void this.writeQuads(name, sv);
			}
		}
	}

	getStore(): IQuadStore {
		return this.store;
	}

	async clear() {
		await this.store.clear(SHARED_GRAPH);
	}

	async all(): Promise<{ [name: string]: TStepValue }> {
		const quads = await this.store.query({ namedGraph: SHARED_GRAPH });
		const result: { [name: string]: TStepValue } = {};
		for (const q of quads) {
			result[q.subject] = { term: q.subject, domain: q.predicate, value: q.object, origin: Origin.var };
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
		const readonly = await this.store.get(sv.term, "readonly", META_GRAPH);
		if (readonly) throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		return this._set(sv, provenance, namedGraph);
	}

	async _set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph: string = SHARED_GRAPH) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey];
		if (domain === undefined) throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		await this.writeQuads(sv.term, normalized, namedGraph);

		const timestamp = Date.now();
		this.world.eventLogger.emit({
			id: `quad-${timestamp}`,
			timestamp,
			source: "haibun",
			level: "debug" as const,
			kind: "artifact" as const,
			artifactType: "json" as const,
			mimetype: "application/json",
			json: { quadObservation: { subject: sv.term, predicate: domainKey, object: this.isSecret(sv.term) ? OBSCURED_VALUE : normalized.value, namedGraph } },
		});
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

		const storedEntry = await this.getStoredEntry(lookupTerm);

		if (!input.origin || input.origin === Origin.statement) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = this.world.options.envVariables[lookupTerm];
			resolved.domain = DOMAIN_STRING;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			if (storedEntry) {
				resolved.domain = storedEntry.domain;
				resolved.value = storedEntry.value;
				resolved.origin = Origin.var;
				resolved.secret = storedEntry.secret ?? this.isSecret(lookupTerm);
			} else if (lookupTerm.includes(".")) {
				const dotResult = await this.resolveDotPath(lookupTerm);
				if (dotResult.found) {
					resolved.value = dotResult.value;
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				}
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
				resolved.secret = this.isSecret(lookupTerm);
			} else if (storedEntry) {
				resolved.value = storedEntry.value;
				resolved.domain = storedEntry.domain;
				resolved.origin = Origin.var;
				resolved.secret = storedEntry.secret ?? this.isSecret(lookupTerm);
			} else if (lookupTerm.includes(".")) {
				const dotResult = await this.resolveDotPath(lookupTerm);
				if (dotResult.found) {
					resolved.value = dotResult.value;
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else if (isLiteralValue(input.term)) {
					resolved.value = input.term;
					resolved.domain = DOMAIN_STRING;
				}
			} else if (isLiteralValue(input.term)) {
				resolved.value = input.term;
				resolved.domain = DOMAIN_STRING;
			}
		} else if (input.origin === Origin.quoted) {
			if (input.term.startsWith("{") && input.term.endsWith("}") && !input.term.includes(":")) {
				if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
					resolved.value = featureStep.runtimeArgs[lookupTerm];
					resolved.domain = DOMAIN_STRING;
					resolved.origin = Origin.var;
				} else if (storedEntry) {
					resolved.value = storedEntry.value;
					resolved.domain = storedEntry.domain;
					resolved.origin = Origin.var;
					resolved.secret = storedEntry.secret ?? this.isSecret(lookupTerm);
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
			const fromVariableOrEnv = resolved.origin === Origin.env || resolved.origin === Origin.var;
			if (!options.secure && fromVariableOrEnv && isSecretValue) resolved.value = OBSCURED_VALUE;
		}

		return resolved as TStepValue;
	}

	/** Reconstruct a stored variable entry from quads. */
	private async getStoredEntry(name: string): Promise<{ value: unknown; domain: string; readonly?: boolean; secret?: boolean } | undefined> {
		const quads = await this.store.query({ subject: name, namedGraph: SHARED_GRAPH });
		if (quads.length === 0) return undefined;
		const q = quads[quads.length - 1];
		const readonly = await this.store.get(name, "readonly", META_GRAPH);
		const secret = await this.store.get(name, "secret", META_GRAPH);
		return { value: q.object, domain: q.predicate, readonly: readonly === true ? true : undefined, secret: secret === true ? true : undefined };
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

	async queryQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<TQuad[]> {
		return await this.store.query(pattern);
	}

	async existsQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<boolean> {
		return (await this.queryQuads(pattern)).length > 0;
	}

	async countQuads(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<number> {
		return (await this.queryQuads(pattern)).length;
	}

	async addQuad(quad: Omit<TQuad, "timestamp">): Promise<void> {
		await this.store.add(quad);
		const timestamp = Date.now();
		this.world.eventLogger.emit({
			id: `quad-${timestamp}-${quad.subject}-${quad.predicate}`,
			timestamp,
			source: "haibun",
			level: "debug" as const,
			kind: "artifact" as const,
			artifactType: "json" as const,
			mimetype: "application/json",
			json: { quadObservation: quad },
		} as THaibunEvent);
	}

	async removeQuad(pattern: { subject?: string; predicate?: string; object?: unknown; namedGraph?: string }): Promise<void> {
		await this.store.remove(pattern);
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
		const allVars = await this.all();
		for (const [key, variable] of Object.entries(allVars)) {
			if (this.isSecret(key)) secrets[key] = String(variable.value);
		}
		return secrets;
	}

	private async writeQuads(name: string, sv: TStepValue, namedGraph: string = SHARED_GRAPH): Promise<void> {
		const domainKey = normalizeDomainKey(sv.domain);
		await this.store.set(name, domainKey, sv.value, namedGraph);
		if (sv.origin) await this.store.set(name, "origin", sv.origin, META_GRAPH);
		if (sv.readonly) await this.store.set(name, "readonly", true, META_GRAPH);
		if (sv.secret) await this.store.set(name, "secret", true, META_GRAPH);
	}
}
