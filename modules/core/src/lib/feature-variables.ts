import { z } from "zod";
import { AStepper, TFeatureStep } from "./astepper.js";
import { fromJsonText } from "./json-text.js";
import { parseDotPath, navigateValue } from "./util/dot-path.js";
import { itemAt } from "./util/item-at.js";
import { runEnvVariables, type TWorld } from "./world.js";
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue } from "../schema/protocol.js";
import { DOMAIN_JSON, DOMAIN_NUMBER, DOMAIN_STRING, DOMAIN_UNION, domainParts, namesMember, normalizeDomainKey, persistedDomainOf, registeredDomain } from "./domains.js";
import { readDeclarationsOf } from "./records/derivations/read-records.js";
import { readEvery, recordOf } from "./records/pipelines/record-reads.js";
import { ontologyReader } from "./records/pipelines/ontology-records.js";
import { VARIABLE_FIELD } from "./records/domains/variables.js";
import { QuadStore } from "./quad-store.js";
import { accessBound, readingAsStated, writeBound } from "./capability-context.js";
import { EDGE, SEQ_PATH_LABEL, declaredAccessLevel } from "./resources.js";
import { executionOf, formatRecordName } from "./seq-path.js";
import { IQuadStore, SHARED_GRAPH, emitQuadObservation } from "./quad-types.js";

export { SHARED_GRAPH };
export const OBSCURED_VALUE = "[o̴b̵s̵c̷u̶r̸e̵d̵]";

/** A value as a message, an event or a record states it: a secret's value is obscured. */
export const statedValue = (value: unknown, secret: boolean | undefined): unknown => (secret === true ? OBSCURED_VALUE : value);

/** The domain of a value a dot path reads from JSON: a number compares as a number, text as text, and a list, an object, a
 *  boolean or null as the JSON it is. */
const jsonValueDomain = (value: unknown): string => (typeof value === "number" ? DOMAIN_NUMBER : typeof value === "string" ? DOMAIN_STRING : DOMAIN_JSON);

/** A variable a next scope starts from, with the record names of the steps that set it. */
export type TCarriedVariable = TStepValue & { generatedBy?: string[] };

const isOrigin = (value: unknown): value is TOrigin => typeof value === "string" && value in Origin;

/** A variable as its record states it. A secret's record holds the obscured value. Throws where the record states an
 *  origin that isn't one of `Origin`. */
function variableOf(record: Record<string, unknown>): TStepValue {
	const term = String(record[VARIABLE_FIELD.name]);
	const origin = record[VARIABLE_FIELD.origin];
	if (!isOrigin(origin)) throw new Error(`the variable ${term} states the origin ${String(origin)}, which isn't one of ${Object.keys(Origin).join(", ")}`);
	return {
		term,
		domain: String(record[VARIABLE_FIELD.domain]),
		value: record[VARIABLE_FIELD.value],
		origin,
		...(record[VARIABLE_FIELD.readonly] === true ? { readonly: true } : {}),
		...(record[VARIABLE_FIELD.secret] === true ? { secret: true } : {}),
	};
}

export class FeatureVariables {
	private store: QuadStore;
	/** Each secret variable's value, by name, apart from the graph, which holds the obscured value. Resolution, `carried`
	 *  and `getSecrets` read this map. */
	private readonly secretValues = new Map<string, unknown>();

	constructor(
		private world: TWorld,
		initial?: { [name: string]: TCarriedVariable },
	) {
		// The predecessor's backing routing and federated peers are shared by reference, never copied: a registration
		// anywhere in the chain is visible to every store in it, and its owner's unregister removes it from all at once.
		const prev = world.shared?.getStore();
		const prevStore = prev instanceof QuadStore ? prev : undefined;
		this.store = new QuadStore(
			prevStore?.backingRouting(),
			prevStore?.backingFederated(),
			{ bound: accessBound, writeBound, declared: (label) => declaredAccessLevel(persistedDomainOf(world.domains, label)) },
			() => readDeclarationsOf(world.domains),
			ontologyReader(
				() => world.domains,
				(message) => world.eventLogger.warn(message),
			),
		);
		prevStore?.carryNonVariableQuadsTo(this.store);
		if (initial) {
			for (const [name, { generatedBy, ...sv }] of Object.entries(initial)) {
				void this.writeRecord(name, sv, generatedBy ?? []);
			}
		}
	}

	getStore(): IQuadStore {
		return this.store;
	}

	/** The variables as the graph holds them, so a secret's value is obscured. */
	async all(): Promise<{ [name: string]: TStepValue }> {
		return Object.fromEntries((await this.variableRecords()).map((record) => [String(record[VARIABLE_FIELD.name]), variableOf(record)]));
	}

	/** The variables a next scope starts from. Each holds its value and the steps that set it, and a secret holds its value
	 *  from `secretValues`. */
	async carried(): Promise<{ [name: string]: TCarriedVariable }> {
		const generatedBy = await this.stepsThatSet();
		return Object.fromEntries(
			(await this.variableRecords()).map((record) => {
				const variable = variableOf(record);
				return [variable.term, { ...variable, value: this.valueOf(variable), generatedBy: generatedBy.get(variable.term) ?? [] }];
			}),
		);
	}

	/** Removes every quad of the store and every secret's value. */
	async clear(): Promise<void> {
		await this.store.clear();
		this.secretValues.clear();
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

	async setForStepper(stepper: string, sv: TStepValue, provenance: TProvenanceIdentifier) {
		return await this._set({ ...sv, term: `${stepper}.${sv.term}` }, provenance);
	}

	async unset(name: string) {
		await this.store.remove({ subject: name, namedGraph: SHARED_GRAPH });
		this.secretValues.delete(name);
	}

	async set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		if (sv.term.match(/.*\..*/)) throw Error("non-stepper variables cannot use dots");
		if (runEnvVariables(this.world)[sv.term]) throw Error(`Cannot overwrite environment variable "${sv.term}"`);
		const existing = await this.getStoredEntry(sv.term);
		if (existing?.readonly) throw Error(`Cannot overwrite read-only variable "${sv.term}"`);
		return await this._set(sv, provenance);
	}

	/** Writes a variable's record with an edge to each step that set it, and emits the record's quads as the graph holds them. */
	async _set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey];
		if (domain === undefined) throw Error(`Cannot set variable "${sv.term}": unknown domain "${sv.domain}"`);
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		const setBy = formatRecordName({ execution: executionOf(this.world.tag), path: provenance.seq });
		const generatedBy = [...new Set([...((await this.stepsThatSet(sv.term)).get(sv.term) ?? []), setBy])];
		await this.writeRecord(sv.term, normalized, generatedBy);
		for (const [index, quad] of (await this.store.query({ subject: sv.term, namedGraph: SHARED_GRAPH })).entries())
			emitQuadObservation(this.world.eventLogger, `quad-${quad.timestamp}-${index}`, quad);
	}

	/** Look up a variable from store or dot-path. Shared by Origin.var, Origin.defined, Origin.quoted. */
	private async lookupVariable(term: string): Promise<Partial<TStepValue> | undefined> {
		const entry = await this.getStoredEntry(term);
		if (entry) return { value: entry.value, domain: entry.domain, origin: Origin.var, secret: entry.secret };
		if (term.includes(".")) {
			const dot = await this.resolveDotPath(term);
			if (dot.found) return { value: dot.value, domain: jsonValueDomain(dot.value), origin: Origin.var, secret: dot.secret };
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

	/** `template` with each `{name}` given the value `name` resolves to, as a bare term resolves: a runtime argument, an
	 *  environment variable or a variable. A lenient caller matches text, so a placeholder that doesn't resolve stays. */
	async interpolate(template: string, featureStep?: TFeatureStep, options?: { lenient?: boolean }): Promise<{ value: string; secret: boolean } | { error: string }> {
		let value = template;
		let secret = false;
		for (const match of template.matchAll(/\{([^{}"]+)\}/g)) {
			const name = itemAt(match, 1);
			const resolved = await this.resolveTerm({ term: name, origin: Origin.defined }, featureStep, undefined, { secure: true });
			if (resolved.value === undefined) {
				if (options?.lenient) continue;
				return { error: `Variable ${name} not found` };
			}
			// A value built from a secret is a secret.
			if (resolved.secret === true || this.isSecret(name)) secret = true;
			value = value.replace(match[0], () => String(resolved.value));
		}
		return { value, secret };
	}

	/** A variable's name as a line writes it, with each `{name}` in it filled. */
	private async filledName(name: string, featureStep?: TFeatureStep): Promise<string> {
		if (!name.includes("{")) return name;
		const filled = await this.interpolate(name, featureStep);
		if ("error" in filled) throw new Error(`${filled.error}, in the variable name ${name}`);
		return filled.value;
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
			resolved.value = this.world.domains[input.domain ?? ""]?.filled ? await this.filledName(input.term, featureStep) : input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = runEnvVariables(this.world)[lookupTerm];
			resolved.domain = writtenDomain;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			Object.assign(resolved, await this.lookupVariable(await this.filledName(input.term, featureStep)));
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

	/** Reads a variable's record, with a secret's value from `secretValues`. */
	private async getStoredEntry(name: string): Promise<(TStepValue & { value: unknown }) | undefined> {
		const record = await recordOf(this.store, SHARED_GRAPH, name);
		if (!record) return undefined;
		const variable = variableOf(record);
		return { ...variable, value: this.valueOf(variable) };
	}

	/** A variable's value: the value its record holds, or a secret's value from `secretValues`. */
	private valueOf(variable: TStepValue): unknown {
		if (variable.secret !== true) return variable.value;
		if (!this.secretValues.has(variable.term)) throw new Error(`The secret variable "${variable.term}" doesn't have a value: FeatureVariables didn't write it`);
		return this.secretValues.get(variable.term);
	}

	private variableRecords(): Promise<Record<string, unknown>[]> {
		return readEvery(this.store, { label: SHARED_GRAPH });
	}

	/** Returns the record names of the steps that set each variable, or that set the one variable `name` names. */
	private async stepsThatSet(name?: string): Promise<Map<string, string[]>> {
		const edges = await this.store.query({ ...(name === undefined ? {} : { subject: name }), predicate: EDGE.wasGeneratedBy, namedGraph: SHARED_GRAPH });
		const bySubject = new Map<string, string[]>();
		for (const edge of edges) bySubject.set(edge.subject, [...(bySubject.get(edge.subject) ?? []), String(edge.object)]);
		return bySubject;
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

	/** Whether `term` is a dot path into a variable that holds fields and names a field it doesn't have. */
	async namesAMissingField(term: string): Promise<boolean> {
		const read = await this.resolveDotPath(term);
		return !read.found && "miss" in read && read.miss.has.length > 0;
	}

	private async resolveDotPath(lookupTerm: string): Promise<(ReturnType<typeof navigateValue> & { secret?: boolean }) | { value: undefined; found: false }> {
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
		// A field of a secret is a secret.
		return { ...navigateValue(baseValue, pathSegments), secret: baseEntry.secret };
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

	isSecret(name: string): boolean {
		return /(password|secret)/i.test(name);
	}

	async getSecrets(): Promise<{ [name: string]: string }> {
		const secrets: { [name: string]: string } = {};
		for (const [key, value] of Object.entries(runEnvVariables(this.world))) {
			if (this.isSecret(key)) secrets[key] = String(value);
		}
		for (const record of await this.variableRecords()) {
			const variable = variableOf(record);
			if (variable.secret === true) secrets[variable.term] = String(this.valueOf(variable));
		}
		return secrets;
	}

	/**
	 * Writes a variable's record and an edge to each step that set it. A secret's value is held in `secretValues`, and its
	 * record holds the obscured value. A value is secret where its name marks it or where it was built from a secret. Each
	 * write of the in-memory store starts when it is called, so the record is written before this method first waits.
	 */
	private async writeRecord(name: string, sv: TStepValue, generatedBy: readonly string[]): Promise<void> {
		const secret = sv.secret === true || this.isSecret(name);
		if (secret) this.secretValues.set(name, sv.value);
		else this.secretValues.delete(name);
		const record = {
			[VARIABLE_FIELD.name]: name,
			[VARIABLE_FIELD.domain]: normalizeDomainKey(sv.domain),
			[VARIABLE_FIELD.value]: statedValue(sv.value, secret),
			[VARIABLE_FIELD.origin]: sv.origin,
			[VARIABLE_FIELD.generatedAtTime]: new Date().toISOString(),
			...(sv.readonly ? { [VARIABLE_FIELD.readonly]: true } : {}),
			...(secret ? { [VARIABLE_FIELD.secret]: true } : {}),
		};
		await Promise.all([
			this.store.upsertIndividual(SHARED_GRAPH, record),
			...generatedBy.map((step) => this.store.createEdge(SHARED_GRAPH, name, EDGE.wasGeneratedBy, SEQ_PATH_LABEL, step)),
		]);
	}
}
