import { z } from "zod";
import { AStepper, TFeatureStep } from "./astepper.js";
import { fromJsonText } from "./json-text.js";
import { parseDotPath, navigateValue } from "./util/dot-path.js";
import { runEnvVariables, type TWorld } from "./world.js";
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue } from "../schema/protocol.js";
import { DOMAIN_JSON, DOMAIN_NUMBER, DOMAIN_STRING, DOMAIN_UNION, domainParts, namesMember, normalizeDomainKey, registeredDomain } from "./domains.js";
import { QuadStore } from "./quad-store.js";
import { accessBound, readingAsStated } from "./capability-context.js";
import { declaredAccessLevel } from "./resources.js";
import { IQuadStore, SHARED_GRAPH, TQuad, emitQuadObservation } from "./quad-types.js";

export { SHARED_GRAPH };
export const OBSCURED_VALUE = "[o̴b̵s̵c̷u̶r̸e̵d̵]";

/** The domain of a value a dot path reads from JSON: a number compares as a number, text as text, and a list, an object, a
 *  boolean or null as the JSON it is. */
const jsonValueDomain = (value: unknown): string => (typeof value === "number" ? DOMAIN_NUMBER : typeof value === "string" ? DOMAIN_STRING : DOMAIN_JSON);

export class FeatureVariables {
	private store: IQuadStore;

	constructor(
		private world: TWorld,
		initial?: { [name: string]: TStepValue },
	) {
		// The predecessor's backing routing and federated peers are shared by reference, never copied: a registration
		// anywhere in the chain is visible to every store in it, and its owner's unregister removes it from all at once.
		const prev = world.shared?.getStore();
		const prevStore = prev instanceof QuadStore ? prev : undefined;
		this.store = new QuadStore(prevStore?.backingRouting(), prevStore?.backingFederated(), { bound: accessBound, declared: (label) => declaredAccessLevel(world.domains[label]) });
		prevStore?.carryNonVariableQuadsTo(this.store as QuadStore);
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
		if (runEnvVariables(this.world)[sv.term]) throw Error(`Cannot overwrite environment variable "${sv.term}"`);
		const existing = await this.getStoredEntry(sv.term);
		if (existing?.readonly) throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		return await this._set(sv, provenance, namedGraph);
	}

	async _set(sv: TStepValue, provenance: TProvenanceIdentifier, namedGraph: string = SHARED_GRAPH) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey];
		if (domain === undefined) throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		await this.writeQuads(sv.term, normalized, namedGraph, provenance);

		const timestamp = Date.now();
		emitQuadObservation(this.world.eventLogger, `quad-${timestamp}`, {
			subject: sv.term,
			predicate: domainKey,
			object: this.isSecret(sv.term) ? OBSCURED_VALUE : normalized.value,
			namedGraph,
			timestamp,
		});
	}

	/** Look up a variable from store or dot-path. Shared by Origin.var, Origin.defined, Origin.quoted. */
	private async lookupVariable(term: string): Promise<Partial<TStepValue> | undefined> {
		const entry = await this.getStoredEntry(term);
		if (entry) return { value: entry.value, domain: entry.domain, origin: Origin.var, secret: entry.secret ?? this.isSecret(term) };
		if (term.includes(".")) {
			const dot = await this.resolveDotPath(term);
			if (dot.found) return { value: dot.value, domain: jsonValueDomain(dot.value), origin: Origin.var };
		}
		return undefined;
	}

	/** Resolve a term a statement names. A statement's terms are its author's, so they are read at the ceiling the statement
	 *  was stated at, whatever the step it states narrows its own reads to. */
	resolveVariable(
		input: { term: string; origin: TOrigin; domain?: string },
		featureStep?: TFeatureStep,
		steppers?: AStepper[],
		options: { secure: boolean } = { secure: false },
	): Promise<TStepValue> {
		return readingAsStated(() => this.resolveTerm(input, featureStep, steppers, options));
	}

	private async resolveTerm(
		input: { term: string; origin: TOrigin; domain?: string },
		featureStep?: TFeatureStep,
		steppers?: AStepper[],
		options: { secure: boolean } = { secure: false },
	): Promise<TStepValue> {
		const resolved: Partial<TStepValue> = { term: input.term, value: undefined };
		// A literal, an environment variable's value and a runtime argument are coerced by the parameter's domain.
		const writtenDomain = input.domain ?? DOMAIN_STRING;
		let lookupTerm = input.term;
		if (lookupTerm.startsWith("{") && lookupTerm.endsWith("}")) lookupTerm = lookupTerm.slice(1, -1);

		if (!input.origin || (input.domain && this.world.domains[input.domain]?.written)) {
			resolved.value = input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = runEnvVariables(this.world)[lookupTerm];
			resolved.domain = writtenDomain;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			Object.assign(resolved, await this.lookupVariable(lookupTerm));
		} else if (input.origin === Origin.defined) {
			if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
				resolved.value = featureStep.runtimeArgs[lookupTerm];
				resolved.domain = writtenDomain;
				resolved.origin = Origin.var;
			} else if (runEnvVariables(this.world)[lookupTerm]) {
				resolved.value = runEnvVariables(this.world)[lookupTerm];
				resolved.domain = writtenDomain;
				resolved.origin = Origin.env;
				resolved.secret = this.isSecret(lookupTerm);
			} else {
				const found = await this.lookupVariable(lookupTerm);
				if (found) {
					Object.assign(resolved, found);
				} else if (await this.namesAMissingField(lookupTerm)) {
					// A term whose first part names a variable that holds fields is a read of that variable, so the refusal names the
					// field it doesn't have and the fields it has.
					throw new Error(`${await this.unsetReason(lookupTerm)}. Quote the term to pass it as a literal.`);
				} else if (featureStep?.runtimeArgs && Object.values(featureStep.runtimeArgs).includes(input.term)) {
					// A waypoint's argument is written into its activity's lines as a term, so an argument that doesn't name a
					// variable is its own text here, as it is where the waypoint is called.
					resolved.value = input.term;
					resolved.domain = writtenDomain;
				} else if (input.domain && namesMember(this.world.domains[input.domain], input.term)) {
					// A bare word naming a value of its parameter's own domain is that value, as `by placeholder` names a way to find.
					resolved.value = input.term;
					resolved.domain = input.domain;
				}
			}
		} else if (input.origin === Origin.quoted) {
			if (input.term.startsWith("{") && input.term.endsWith("}") && !input.term.includes(":")) {
				if (featureStep?.runtimeArgs?.[lookupTerm] !== undefined) {
					resolved.value = featureStep.runtimeArgs[lookupTerm];
					resolved.domain = writtenDomain;
					resolved.origin = Origin.var;
				} else {
					Object.assign(resolved, await this.lookupVariable(lookupTerm));
				}
			} else {
				resolved.value = input.term.replace(/^"|"$/g, "");
				resolved.domain = writtenDomain;
			}
		} else {
			throw new Error(`Unsupported origin type: ${input.origin}`);
		}

		if (resolved.value !== undefined) {
			const rawDomainKey = resolved.domain ?? DOMAIN_STRING;
			const parts = domainParts(rawDomainKey)
				.map((s) => s.trim())
				.filter(Boolean)
				.sort();
			const sortedKey = parts.join(DOMAIN_UNION);
			const isUnion = parts.length > 1;
			const domainKey = this.world.domains[sortedKey] ? sortedKey : isUnion ? DOMAIN_STRING : sortedKey;
			const domain = registeredDomain(this.world.domains, domainKey, `variable "${input.term}"`);
			resolved.value = domain.coerce({ ...(resolved as TStepValue), domain: domainKey }, featureStep, steppers);
			resolved.domain = domainKey;
			const isSecretValue = resolved.secret === true || this.isSecret(lookupTerm);
			if (!options.secure && (resolved.origin === Origin.env || resolved.origin === Origin.var) && isSecretValue) resolved.value = OBSCURED_VALUE;
		}

		return resolved as TStepValue;
	}

	/** Reconstruct a stored variable entry from the quad's properties. */
	private async getStoredEntry(name: string): Promise<{ value: unknown; domain: string; readonly?: boolean; secret?: boolean; origin?: TOrigin } | undefined> {
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

	/** Why `term` doesn't resolve: a variable that isn't set, or a dot path that names a field its value doesn't have,
	 *  with the fields that value has. */
	async unsetReason(term: string): Promise<string> {
		const read = await this.resolveDotPath(term);
		if (read.found || !("miss" in read)) return `${term} isn't set`;
		const { at, missing, has } = read.miss;
		const where = [parseDotPath(term).baseName, ...at].join(".");
		return has.length > 0 ? `${where} doesn't have ${missing}; it has ${has.join(", ")}` : `${where} doesn't have ${missing}, since it doesn't hold fields`;
	}

	/** Whether a term is a dot path into a variable that holds fields, naming a field it doesn't have. A variable that
	 *  holds a single value doesn't have fields to read, so a term that starts with its name is still a literal. */
	private async namesAMissingField(term: string): Promise<boolean> {
		const read = await this.resolveDotPath(term);
		return !read.found && "miss" in read && read.miss.has.length > 0;
	}

	private async resolveDotPath(lookupTerm: string): Promise<ReturnType<typeof navigateValue> | { value: undefined; found: false }> {
		const { baseName, pathSegments } = parseDotPath(lookupTerm);
		const baseEntry = pathSegments.length > 0 ? await this.getStoredEntry(baseName) : undefined;
		if (!baseEntry) return { value: undefined, found: false };
		let baseValue = baseEntry.value;
		if (typeof baseValue === "string") {
			// A base that holds text rather than JSON doesn't have fields.
			const read = fromJsonText(z.json()).safeParse(baseValue);
			if (!read.success) return { value: undefined, found: false };
			baseValue = read.data;
		}
		return navigateValue(baseValue, pathSegments);
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

	/** A variable as the step in progress reads it, within its own ceiling. */
	async get(term: string, secure: boolean = false) {
		return (await this.resolveTerm({ term, origin: Origin.defined }, undefined, undefined, { secure })).value;
	}

	async allQuads(): Promise<TQuad[]> {
		return await this.store.all();
	}

	isSecret(name: string): boolean {
		return /(password|secret)/i.test(name);
	}

	async getSecrets(): Promise<{ [name: string]: string }> {
		const secrets: { [name: string]: string } = {};
		for (const [key, value] of Object.entries(runEnvVariables(this.world))) {
			if (this.isSecret(key)) secrets[key] = String(value);
		}
		// Query raw quads to get unmasked values for secret detection
		const quads = await this.store.query({ namedGraph: SHARED_GRAPH });
		for (const q of quads) {
			if (q.properties?.secret === true || this.isSecret(q.subject)) secrets[q.subject] = String(q.object);
		}
		return secrets;
	}

	private async writeQuads(name: string, sv: TStepValue, namedGraph: string = SHARED_GRAPH, provenance?: TProvenanceIdentifier): Promise<void> {
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
