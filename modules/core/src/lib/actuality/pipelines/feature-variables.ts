import { z } from "zod";
import { AStepper, TFeatureStep, coercionSite } from "../../steps/domains/stepper.js";
import { fromJsonText, parsedRecord } from "../../domains/json-text.js";
import { parseDotPath, navigateValue } from "../../domains/dot-path.js";
import { itemAt } from "../../domains/item-at.js";
import { runEnvEntries, runEnvVariable, type TWorld } from "../domains/world.js";
import { Origin, TOrigin, TProvenanceIdentifier, TStepValue } from "../../domains/protocol.js";
import {
	DOMAIN_JSON,
	DOMAIN_NUMBER,
	DOMAIN_STRING,
	DOMAIN_UNION,
	domainOfTerm,
	domainParts,
	namesMember,
	normalizeDomainKey,
	persistedDomainOf,
	registeredDomain,
} from "../../domains/domains.js";
import { readDeclarationsOf } from "../../records/derivations/read-records.js";
import { readUpTo } from "../../records/pipelines/record-reads.js";
import { MAX_PAGE_ROWS } from "../../domains/hypermedia.js";
import { declaredRecordsReader } from "../../records/pipelines/declared-records.js";
import { VARIABLE_FIELD, VariableSchema, type TVariable } from "../../records/domains/variables.js";
import { QuadStore, newStoreChain } from "../../steps/pipelines/quad-store.js";
import { OBSCURED_VALUE, isSecretName } from "../../steps/domains/secrets.js";
import type { TSecrets } from "../../steps/ports.js";
import { accessBound, readingAsStated, writeBound, writesInFlight } from "../../domains/capability-context.js";
import { stepRecordInFlight } from "../domains/step-in-flight.js";
import { EDGE, SEQ_PATH_LABEL, declaredAccessLevel } from "../../domains/resources.js";
import { recordTime } from "../domains/record-time.js";
import { actualityFeatureOf, formatRecordName } from "../domains/seq-path.js";
import { IQuadStore } from "../../steps/ports.js";
import { quadObservation, SHARED_GRAPH } from "../../steps/domains/quad-types.js";
import { recordOfCurie, referenceTo } from "../../records/domains/unit.js";
import { listed, listQueries, queriedFields, type TListItem, type TListStage } from "../../domains/lists.js";

export { SHARED_GRAPH };

/** A value as a message, an event or a record states it: a secret's value is obscured. */
export const statedValue = (value: unknown, secret: boolean | undefined): unknown => (secret === true ? OBSCURED_VALUE : value);

/** The domain of a value a dot path reads from JSON: a number compares as a number, text as text, and a list, an object, a
 *  boolean or null as the JSON it is. */
const jsonValueDomain = (value: unknown): string => (typeof value === "number" ? DOMAIN_NUMBER : typeof value === "string" ? DOMAIN_STRING : DOMAIN_JSON);

/** A variable that starts a next scope, with the record names of the steps that set it. */
export type TCarriedVariable = TStepValue & { generatedBy: string[] };

const isOrigin = (value: unknown): value is TOrigin => typeof value === "string" && value in Origin;

/** A variable as its record states it. A secret's record holds the obscured value. Throws where the record states an
 *  origin that isn't one of `Origin`. */
function variableOf(record: TVariable): TStepValue {
	const term = record[VARIABLE_FIELD.name];
	const origin = record[VARIABLE_FIELD.origin];
	if (!isOrigin(origin)) throw new Error(`the variable ${term} states the origin ${origin}, which isn't one of ${Object.keys(Origin).join(", ")}`);
	return {
		term,
		domain: record[VARIABLE_FIELD.domain],
		value: record[VARIABLE_FIELD.value],
		origin,
		...(record[VARIABLE_FIELD.readonly] === true ? { readonly: true } : {}),
		...(record[VARIABLE_FIELD.secret] === true ? { secret: true } : {}),
	};
}

/** The secrets the events hub of `world` obscures: each secret value the world's variables hold once the world holds its
 *  variables. */
export const secretsOf = (world: Partial<Pick<TWorld, "shared">>): TSecrets => ({ values: () => (world.shared === undefined ? [] : world.shared.secretTexts()) });

/** The steps that set a variable, from the steps `stepsThatSet` read for the names it was given. */
function stepsOf(stepsThatSet: ReadonlyMap<string, string[]>, name: string): string[] {
	const steps = stepsThatSet.get(name);
	if (steps === undefined) throw new Error(`the steps that set "${name}" weren't read; read them for every variable a caller names`);
	return steps;
}

/** The domain of a binding: a metric that is a number is of the number domain, and every other binding is of the domain its term states. */
const boundDomain = (bound: string | number, written: string): string => (typeof bound === "number" ? DOMAIN_NUMBER : written);

export class FeatureVariables {
	private store: QuadStore;
	/** Each secret variable's value, by name, apart from the graph, which holds the obscured value. Resolution, `carried`
	 *  and `secretTexts` read this map. */
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
			prevStore === undefined ? newStoreChain() : prevStore.storeChain(),
			{
				bound: accessBound,
				writeBound,
				declared: (label: string) => declaredAccessLevel(persistedDomainOf(world.domains, label)),
				stepWrites: writesInFlight,
				currentStep: () => stepRecordInFlight(actualityFeatureOf(world.tag)),
				recordTime: () => recordTime(world),
			},
			() => readDeclarationsOf(world.domains, world.runtime.records),
			declaredRecordsReader(
				() => world.domains,
				() => world.runtime.records,
				(message) => world.eventLogger.warn(message),
			),
		);
		prevStore?.carryNonVariableQuadsTo(this.store);
		if (initial) {
			for (const [name, { generatedBy, ...sv }] of Object.entries(initial)) {
				void this.writeRecord(name, sv, generatedBy);
			}
		}
	}

	getStore(): IQuadStore {
		return this.store;
	}

	/** The variables as the graph holds them, so a secret's value is obscured. */
	async all(): Promise<{ [name: string]: TStepValue }> {
		return Object.fromEntries((await this.variableRecords()).map((record) => [record[VARIABLE_FIELD.name], variableOf(record)]));
	}

	/** The variables that start a next scope. Each holds its value and the steps that set it, and a secret holds its value
	 *  from `secretValues`. */
	async carried(): Promise<{ [name: string]: TCarriedVariable }> {
		const variables = (await this.variableRecords()).map(variableOf);
		const generatedBy = await this.stepsThatSet(variables.map((variable) => variable.term));
		return Object.fromEntries(variables.map((variable) => [variable.term, { ...variable, value: this.valueOf(variable), generatedBy: stepsOf(generatedBy, variable.term) }]));
	}

	/** Removes every record of this store's own layer but the SeqPath records, and every secret's value. The store then holds
	 *  the records of the actuality and of every feature, scenario and step it ran, and an observation such as a feature's
	 *  requests reads only that feature's records. A backing store holds what persists, so the clear doesn't read it. */
	async clear(): Promise<void> {
		for (const graph of this.store.ownGraphs()) if (graph !== SEQ_PATH_LABEL) await this.store.clear(graph);
		this.secretValues.clear();
	}

	toString() {
		return `tag ${JSON.stringify(this.world.tag)}`;
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
		await this.store.remove({ label: SHARED_GRAPH, id: name });
		this.secretValues.delete(name);
	}

	async set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		if (sv.term.match(/.*\..*/)) throw Error(`the name "${sv.term}" holds a dot, which only a stepper's variable holds; name the variable without a dot`);
		if (runEnvVariable(this.world, sv.term)) throw Error(`the environment holds "${sv.term}", which a feature reads and doesn't set; set a variable of another name`);
		const existing = await this.getStoredEntry(sv.term);
		if (existing?.readonly) throw Error(`the variable "${sv.term}" is read-only; set a variable of another name`);
		return await this._set(sv, provenance);
	}

	/** Writes a variable's record with an edge to the step that set it, and emits one observation of the record's quads as the graph holds them. */
	async _set(sv: TStepValue, provenance: TProvenanceIdentifier) {
		const domainKey = normalizeDomainKey(sv.domain);
		const domain = this.world.domains[domainKey];
		if (domain === undefined) throw Error(`the variable "${sv.term}" names the domain "${sv.domain}", which isn't registered; declare it with set of or load its stepper`);
		const normalized = { ...sv, domain: domainKey };
		domain.coerce(normalized);
		const setBy = formatRecordName({ actuality: actualityFeatureOf(this.world.tag), path: provenance.seq });
		// A record's write keeps its edges, so only an edge to a step that hadn't set the variable is written.
		const held = stepsOf(await this.stepsThatSet([sv.term]), sv.term);
		await this.writeRecord(sv.term, normalized, held.includes(setBy) ? [] : [setBy]);
		const quads = await this.store.query({ subject: sv.term, namedGraph: SHARED_GRAPH });
		const timestamp = this.world.clock.now();
		this.world.eventLogger.emit(quadObservation(`unit-${SHARED_GRAPH}-${sv.term}-${timestamp}`, timestamp, quads));
	}

	/** Look up a variable from store or dot-path. Shared by Origin.var, Origin.defined, Origin.quoted. */
	private async lookupVariable(term: string, featureStep: TFeatureStep | undefined): Promise<Partial<TStepValue> | undefined> {
		const entry = await this.getStoredEntry(term);
		if (entry) return { value: entry.value, domain: entry.domain, origin: Origin.var, secret: entry.secret };
		if (term.includes(".")) {
			const dot = await this.resolveDotPath(term, featureStep);
			if (dot.found) return { value: dot.value, domain: jsonValueDomain(dot.value), origin: Origin.var, secret: dot.secret };
		}
		return undefined;
	}

	/** Resolve a term a statement names. A statement's terms are its author's, so they are read at the ceiling the statement
	 *  was stated at, whatever ceiling the step it states narrows its own reads within. */
	resolveVariable(
		input: { term: string; origin: TOrigin; domain?: string },
		featureStep?: TFeatureStep,
		steppers?: AStepper[],
		options?: { secure: boolean },
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
		options?: { secure: boolean },
	): Promise<TStepValue> {
		const resolved: Partial<TStepValue> = { term: input.term, value: undefined };
		// A literal, an environment variable's value and a runtime argument are coerced by the parameter's domain.
		const writtenDomain = domainOfTerm(input.domain);
		let lookupTerm = input.term;
		if (lookupTerm.startsWith("{") && lookupTerm.endsWith("}")) lookupTerm = lookupTerm.slice(1, -1);

		if (!input.origin || (input.domain && this.world.domains[input.domain]?.written)) {
			resolved.value = input.domain !== undefined && this.world.domains[input.domain]?.filled ? await this.filledName(input.term, featureStep) : input.term;
			resolved.domain = input.domain;
		} else if (input.origin === Origin.env) {
			resolved.value = runEnvVariable(this.world, lookupTerm);
			resolved.domain = writtenDomain;
			resolved.origin = Origin.env;
			resolved.secret = this.isSecret(lookupTerm);
		} else if (input.origin === Origin.var) {
			// A binding of a quantifier or a waypoint is a variable within the statement it binds.
			const name = await this.filledName(input.term, featureStep);
			const bound = featureStep?.runtimeArgs?.[name];
			if (bound === undefined) Object.assign(resolved, await this.lookupVariable(name, featureStep));
			else Object.assign(resolved, { value: bound, domain: boundDomain(bound, writtenDomain), origin: Origin.var });
		} else if (input.origin === Origin.defined) {
			const filled = await this.filledName(lookupTerm, featureStep);
			const bound = featureStep?.runtimeArgs?.[filled];
			if (bound !== undefined) {
				resolved.value = bound;
				resolved.domain = boundDomain(bound, writtenDomain);
				resolved.origin = Origin.var;
			} else if (runEnvVariable(this.world, filled)) {
				resolved.value = runEnvVariable(this.world, filled);
				resolved.domain = writtenDomain;
				resolved.origin = Origin.env;
				resolved.secret = this.isSecret(filled);
			} else {
				const found = await this.lookupVariable(filled, featureStep);
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
				const bound = featureStep?.runtimeArgs?.[lookupTerm];
				if (bound !== undefined) {
					resolved.value = bound;
					resolved.domain = boundDomain(bound, writtenDomain);
					resolved.origin = Origin.var;
				} else {
					Object.assign(resolved, await this.lookupVariable(lookupTerm, featureStep));
				}
			} else {
				resolved.value = input.term.replace(/^"(.*)"$/s, "$1");
				resolved.domain = writtenDomain;
			}
		} else {
			throw new Error(`a term states the origin ${String(input.origin)}, which isn't one of ${Object.keys(Origin).join(", ")}`);
		}

		if (resolved.value !== undefined) {
			const rawDomainKey = domainOfTerm(resolved.domain);
			const parts = domainParts(rawDomainKey)
				.map((s) => s.trim())
				.filter(Boolean)
				.sort();
			const sortedKey = parts.join(DOMAIN_UNION);
			const isUnion = parts.length > 1;
			const domainKey = this.world.domains[sortedKey] ? sortedKey : isUnion ? DOMAIN_STRING : sortedKey;
			const domain = registeredDomain(this.world.domains, domainKey, `variable "${input.term}"`);
			resolved.value = domain.coerce(
				{ ...(resolved as TStepValue), domain: domainKey },
				featureStep === undefined || steppers === undefined ? undefined : coercionSite(featureStep, steppers),
			);
			resolved.domain = domainKey;
			const isSecretValue = resolved.secret === true || this.isSecret(lookupTerm);
			if (options?.secure !== true && (resolved.origin === Origin.env || resolved.origin === Origin.var) && isSecretValue) resolved.value = OBSCURED_VALUE;
		}

		return resolved as TStepValue;
	}

	/** Reads a variable's record, with a secret's value from `secretValues`. */
	private async getStoredEntry(name: string): Promise<(TStepValue & { value: unknown }) | undefined> {
		const record = await this.store.readRecord({ label: SHARED_GRAPH, schema: VariableSchema }, name);
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

	private async variableRecords(): Promise<TVariable[]> {
		return (await readUpTo(this.store, { label: SHARED_GRAPH }, MAX_PAGE_ROWS)).map((record) => parsedRecord(VariableSchema, SHARED_GRAPH, record, false));
	}

	/** Returns the record names of the steps that set each named variable: an empty list for a variable that a step didn't
	 *  set. One name reads that variable's edges alone. */
	private async stepsThatSet(names: readonly string[]): Promise<Map<string, string[]>> {
		const [only] = names;
		const edges = await this.store.query({ ...(names.length === 1 && only !== undefined ? { subject: only } : {}), predicate: EDGE.wasGeneratedBy, namedGraph: SHARED_GRAPH });
		const bySubject = new Map(names.map((name): [string, string[]] => [name, []]));
		for (const edge of edges) bySubject.get(edge.subject)?.push(String(edge.object));
		return bySubject;
	}

	/** Why `term` doesn't resolve: a variable that isn't set, or a dot path that names a field its value doesn't have,
	 *  with the fields that value has. */
	async unsetReason(term: string, featureStep?: TFeatureStep): Promise<string> {
		const read = await this.resolveDotPath(term, featureStep);
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

	/** Reads a dot path, `base.field`, from the item a quantifier or `for each` binds to the base, a stored variable's value, or the
	 *  record a CURIE names, in that order. */
	private async resolveDotPath(
		lookupTerm: string,
		featureStep?: TFeatureStep,
	): Promise<(ReturnType<typeof navigateValue> & { secret?: boolean }) | { value: undefined; found: false }> {
		const { baseName, pathSegments } = parseDotPath(lookupTerm);
		if (pathSegments.length === 0) return { value: undefined, found: false };
		const item = featureStep?.boundItems?.[baseName];
		if (item !== undefined) return navigateValue(item, pathSegments);
		const baseEntry = await this.getStoredEntry(baseName);
		if (!baseEntry) return await this.curieDotPath(baseName, pathSegments);
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

	/** Reads a path into the record a CURIE names, `Label:id` or `Label:"id"`, of a type a domain persists. Throws where the path
	 *  starts with a field the domain doesn't declare, naming those it declares. */
	private async curieDotPath(base: string, segments: string[]): Promise<ReturnType<typeof navigateValue> | { value: undefined; found: false }> {
		const named = recordOfCurie(base);
		const domain = named === undefined ? undefined : persistedDomainOf(this.world.domains, named.label);
		if (named === undefined || domain === undefined) return { value: undefined, found: false };
		const { properties, edges } = domain.topology;
		const declared = [...Object.keys(properties), ...Object.keys(edges === undefined ? {} : edges)];
		const field = itemAt(segments, 0);
		if (!declared.includes(field)) throw new Error(`Domain '${named.label}' doesn't declare property '${field}'. Declared properties: ${declared.join(", ")}`);
		const record = await this.store.readRecord({ label: named.label, schema: domain.schema }, named.id.replace(/^"(.*)"$/s, "$1"));
		return record === undefined ? { value: undefined, found: false } : navigateValue(record, segments);
	}

	/**
	 * The members of a domain a quantifier ranges over, each a list's item, as the stages of its statement's list make them: the
	 * members its read returns, which ended by `endedBy`, or else its values as items of their id. The query of the stages' filters,
	 * order, offset and limit reaches a read that takes one, and the store applies it. Throws where the query names a field the
	 * domain doesn't index, or where a stage refuses the list.
	 */
	async getDomainMembers(domainName: string, endedBy: number, stages: readonly TListStage[]): Promise<TListItem[]> {
		const { members } = registeredDomain(this.world.domains, normalizeDomainKey(domainName), "a quantifier's domain");
		const indexed = members?.indexed;
		const [taken] = indexed === undefined ? [] : listQueries(stages);
		const unindexed = taken === undefined || indexed === undefined ? [] : queriedFields(taken.query).filter((field) => !indexed.includes(field));
		if (unindexed.length > 0) throw new Error(`${domainName} doesn't index ${unindexed.join(", ")}; filter and order its members by ${indexed?.join(", ")}`);
		const items = members === undefined ? await this.valueItems(domainName) : await members.read(this.world, endedBy, taken === undefined ? {} : taken.query);
		const list = listed({ items, total: items.length, saturated: false }, stages.slice(taken === undefined ? 0 : taken.stated));
		if ("refused" in list) throw new Error(`the members of ${domainName}: ${list.refused}`);
		return list.items;
	}

	/** A domain's values, each as an item of its id. */
	private async valueItems(domainName: string): Promise<TListItem[]> {
		const found = await this.getDomainValues(domainName);
		if (found.error !== undefined) throw new Error(found.error);
		return found.values.map((value) => ({ id: String(value) }));
	}

	async getDomainValues(domainName: string): Promise<{ values: unknown[]; error?: string }> {
		const domainKey = normalizeDomainKey(domainName);
		const domainDef = this.world.domains[domainKey];
		if (!domainDef) return { values: [], error: `the domain "${domainName}" isn't registered; declare it with set of, or load the stepper that declares it` };
		if (Array.isArray(domainDef.values) && domainDef.values.length > 0) return { values: domainDef.values };
		const allVars = await this.all();
		const memberValues = Object.values(allVars)
			.filter((v) => v.domain && normalizeDomainKey(v.domain) === domainKey)
			.map((v) => v.value);
		return { values: memberValues };
	}

	/** A variable as the step in progress reads it, within its own ceiling. */
	async get(term: string, secure?: boolean) {
		return (await this.resolveTerm({ term, origin: Origin.defined }, undefined, undefined, { secure: secure === true })).value;
	}

	isSecret(name: string): boolean {
		return isSecretName(name);
	}

	/** The value of each secret: each environment variable whose name marks it secret, and each secret variable. */
	secretTexts(): string[] {
		const fromEnvironment = runEnvEntries(this.world).flatMap(([name, value]) => (isSecretName(name) ? [String(value)] : []));
		return [...fromEnvironment, ...[...this.secretValues.values()].map(String)];
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
		await this.store.merge({
			"@type": SHARED_GRAPH,
			[VARIABLE_FIELD.name]: name,
			[VARIABLE_FIELD.domain]: normalizeDomainKey(sv.domain),
			[VARIABLE_FIELD.value]: statedValue(sv.value, secret),
			[VARIABLE_FIELD.origin]: sv.origin,
			[VARIABLE_FIELD.readonly]: sv.readonly ? true : null,
			[VARIABLE_FIELD.secret]: secret ? true : null,
			[EDGE.wasGeneratedBy]: generatedBy.map((step) => referenceTo(SEQ_PATH_LABEL, step)),
		});
	}
}
