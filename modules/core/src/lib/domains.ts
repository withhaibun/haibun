import { z } from "zod";
import {
	DOMAIN_PERSISTED_TYPE,
	PRINCIPAL_DOMAIN,
	isPersisted,
	LinkRelations,
	type TDomainDefinition,
	type TDomainTopology,
	type TRegisteredDomain,
	type THypermediaTopology,
	type TRelRange,
} from "./resources.js";
import type { TLinkVocabulary } from "./typed-links.js";
import { parseJsonText } from "./json-text.js";
import type { TWorld } from "./world.js";

export const DOMAIN_STATEMENT = "statement";
export const DOMAIN_STRING = "string";
/** Free text a person writes: a note, a question, a reason or a passage quoted, read as written. */
export const DOMAIN_TEXT = "text";
export const DOMAIN_LINK = "link";
export const DOMAIN_NUMBER = "number";
export const DOMAIN_JSON = "json";
export const DOMAIN_DATE = "date";
/** The actions a caller holds or a delegation allows. */
export const DOMAIN_ACTIONS = "actions";
/** A reference to a Principal by its DID. */
export const DOMAIN_PRINCIPAL_REF = "principal-ref";
/** The id of a record of the type another of its step's parameters names (the step's `recordIds`). */
export const DOMAIN_RECORD_ID = "record-id";
export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_TEXT, DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_DATE, DOMAIN_STATEMENT, DOMAIN_JSON];

// Goal resolver domains.
export const DOMAIN_DOMAIN_KEY = "domain-key";

/** What separates the parts of a union domain's key. */
export const DOMAIN_UNION = " | ";

/** The domains a domain key names: itself, or each part of a union. */
export const domainParts = (domainKey: string): string[] => domainKey.split(DOMAIN_UNION);

/** Primitive domains: a caller supplies their values, no step's product is one, and they aren't nodes of the typed
 *  step graph, since every step would connect through them. */
export const PRIMITIVE_DOMAINS: ReadonlySet<string> = new Set<string>([...BASE_TYPES, DOMAIN_DOMAIN_KEY]);

/** Whether a domain key is primitive: a primitive, or a union with one, which a caller can always supply as it. */
export const isPrimitiveDomain = (domainKey: string): boolean => domainParts(domainKey).some((part) => PRIMITIVE_DOMAINS.has(part));

/** Whether a caller writes a value of the domain in a step's line, so no step needs to produce it: a primitive, or a value
 *  domain naming no thing, which has no topology. A persisted type, or a reference to one, is a thing a step produces. */
export const isWrittenByCaller = (domainKey: string, domains: Record<string, TRegisteredDomain>): boolean =>
	isPrimitiveDomain(domainKey) || domainParts(domainKey).every((part) => domains[part] !== undefined && domains[part].topology === undefined);
export const DOMAIN_GOAL_RESOLUTION = "goal-resolution";
export const DOMAIN_MICHI = "michi";
export const DOMAIN_AFFORDANCES = "affordances";
export const DOMAIN_CHAIN_LINT = "domain-chain-lint";
export const DOMAIN_CHAIN_WALK = "chain-walk";

export type TEnumDomainInput = {
	name: string;
	values: string[];
	description?: string;
	ordered?: boolean;
};

export const registerDomains = (world: TWorld, results: TDomainDefinition[][]) => {
	for (const stepperWithDomains of results) {
		for (const definition of stepperWithDomains) {
			const domainKey = asDomainKey(definition.selectors);

			if (world.domains[domainKey]) continue;

			world.domains[domainKey] = toRegisteredDomain(definition);
		}
	}
};

export const asDomainKey = (domains: string[]) => domains?.sort().join(DOMAIN_UNION);

/** The domain key a step parameter takes: the domain its phrase names, `string` where it names none, a union's parts in order. */
export const paramDomainKey = (declared: string | undefined): string => normalizeDomainKey(asDomainKey(domainParts(declared || DOMAIN_STRING)));

export const normalizeDomainKey = (domain: string) => {
	// Split on the union separator, not on '/' which is used in variable names
	const parts = domain
		?.split(DOMAIN_UNION)
		.map((selector) => selector.trim())
		.filter(Boolean);
	const normalized = asDomainKey(parts);
	if (domain !== normalized) {
		throw Error(`domain key "${domain}", expected "${normalized}"`);
	}
	return normalized;
};

const sanitizeToken = (value: string) => value.trim();

const normalizeEnumValues = (domainName: string, values: string[], requireMultiple = false) => {
	const cleaned = values.map(sanitizeToken).filter(Boolean);
	if (cleaned.length === 0) {
		throw new Error(`Domain "${domainName}" must declare at least one value`);
	}
	if (requireMultiple && cleaned.length < 2) {
		throw new Error(`Domain "${domainName}" must declare at least two values`);
	}
	const unique: string[] = [];
	for (const value of cleaned) {
		if (unique.includes(value)) {
			throw new Error(`Domain "${domainName}" has duplicate value "${value}"`);
		}
		unique.push(value);
	}
	return unique;
};

export const createEnumDomainDefinition = ({ name, values, description, ordered = false }: TEnumDomainInput): TDomainDefinition => {
	const domainName = sanitizeToken(name);
	if (!domainName) {
		throw new Error("Domain name must be provided");
	}
	const uniqueValues = normalizeEnumValues(domainName, values, ordered);
	const descriptor = description ?? `${domainName} values: ${uniqueValues.join(", ")}`;
	const schema = z.enum(uniqueValues as [string, ...string[]]).describe(descriptor);
	return {
		selectors: [domainName],
		schema,
		comparator: ordered ? (value, baseline) => uniqueValues.indexOf(value as string) - uniqueValues.indexOf(baseline as string) : undefined,
		values: uniqueValues,
		description: descriptor,
	};
};

/**
 * A persisted type's topology with the property that states each record's level. Every persisted type states its level,
 * as a field through `PersistedVertexSchema` and as this property, so the property is added here, where every type is
 * registered, and no declaration repeats it. A consumer reads the level from the `accessLevel` property alone, so the
 * property always has that name.
 */
function withLevelProperty(topology: TDomainTopology | undefined): TDomainTopology | undefined {
	if (!isPersisted(topology)) return topology;
	return { ...topology, properties: { ...topology.properties, accessLevel: LinkRelations.ACCESS_LEVEL.rel } };
}

export const toRegisteredDomain = (definition: TDomainDefinition): TRegisteredDomain => ({
	selectors: [...definition.selectors],
	schema: definition.schema,
	coerce: definition.coerce ?? ((proto) => definition.schema.parse(proto.value)),
	comparator: definition.comparator,
	values: definition.values,
	description: definition.description,
	stepperName: definition.stepperName,
	topology: withLevelProperty(definition.topology),
	ui: definition.ui,
});

export const mapDefinitionsToDomains = (definitions: TDomainDefinition[]) => {
	return definitions.reduce<Record<string, TRegisteredDomain>>((acc, definition) => {
		const domainKey = asDomainKey(definition.selectors);
		acc[domainKey] = toRegisteredDomain(definition);
		return acc;
	}, {});
};

/**
 * Schema for an individual reference: a single-field composite that carries just
 * the referenced individual's id. Steps whose action only needs the id of an
 * existing individual use this so the resolver can chain through that individual's
 * producers (or fact-bind an existing instance) without forcing the full
 * individual payload through dispatch.
 */
const individualRefSchema = z.object({ id: z.string() }).strict();
export type TIndividualRef = z.infer<typeof individualRefSchema>;

/**
 * A reference to an individual as a feature line or a call gives it: its id, a reference or its JSON text, or the
 * individual itself, whose id it takes. Each is `{ id }` to the step that takes it. Text that opens as JSON is read as
 * JSON, and refused where it isn't.
 */
const individualRefInputSchema = z.preprocess((value, ctx) => {
	const given = typeof value === "string" && value.trimStart().startsWith("{") ? parseJsonText(value, ctx) : value;
	if (typeof given === "string") return { id: given };
	if (given && typeof given === "object" && typeof (given as { id?: unknown }).id === "string") return { id: (given as { id: string }).id };
	return given;
}, individualRefSchema);

/** The id of a record as a feature line or a call gives it: the id, or a reference or individual carrying it. The step
 *  takes the id. */
export const recordIdInputSchema = individualRefInputSchema.transform((ref) => ref.id);

/**
 * A reusable "reference to individual X" input domain: a composite with one `id` field whose range is `targetKey`, a
 * registered persisted domain. The composite-decomposition layer treats the field as either a fact-binding (an existing
 * X) or a chain through X's producer steps.
 */
export function individualRefDomain(refKey: string, targetKey: string, description?: string): TDomainDefinition {
	return {
		selectors: [refKey],
		schema: individualRefInputSchema,
		description: description ?? `Reference to a ${targetKey} by id`,
		topology: { ranges: { id: targetKey } },
	};
}

/** A reference to a Principal: the DID of a person or service that acts here, or its record. */
export const principalRefDomainDefinition = individualRefDomain(DOMAIN_PRINCIPAL_REF, PRINCIPAL_DOMAIN, "A reference to a Principal by its DID.");

/** Build a Map from persistedAs → TRegisteredDomain for all persisted domains. Returned domains carry a THypermediaTopology so consumers can read id/properties/edges without narrowing. */
export function hypermediaDomainMap(domains: Record<string, TRegisteredDomain>): Map<string, TRegisteredDomain & { topology: THypermediaTopology }> {
	const map = new Map<string, TRegisteredDomain & { topology: THypermediaTopology }>();
	for (const domain of Object.values(domains)) {
		if (isPersisted(domain.topology)) map.set(domain.topology.persistedAs, domain as TRegisteredDomain & { topology: THypermediaTopology });
	}
	return map;
}

/**
 * The declared ontology as a typed link's grammar reads it: which names are property types a link may state, and
 * which are persisted types a link may address. A predicate is either a core rel or a persisted type's own edge:
 * the edge KEY is the written predicate, which is how a consumer's vocabulary becomes writable in prose without
 * this module naming any of it. Abstract rels (the classification-only upper concepts) are excluded: they are never
 * a written predicate.
 */
const linkVocabularyCache = new WeakMap<Record<string, TRegisteredDomain>, TLinkVocabulary>();

/** The vocabulary for a domains registry, computed once per registry: derived data over an object that changes only by
 *  replacement, read on the every-step prose cycle. */
export function linkVocabularyFor(domains: Record<string, TRegisteredDomain>): TLinkVocabulary {
	let vocab = linkVocabularyCache.get(domains);
	if (!vocab) linkVocabularyCache.set(domains, (vocab = linkVocabularyFromDomains(domains)));
	return vocab;
}

export function linkVocabularyFromDomains(domains: Record<string, TRegisteredDomain>): TLinkVocabulary {
	const ranges = new Map<string, TRelRange>();
	for (const entry of Object.values(LinkRelations)) {
		if ((entry as { abstract?: boolean }).abstract) continue;
		ranges.set(entry.rel, entry.range);
	}
	const types = new Set<string>();
	for (const domain of getPersistedDomains(domains)) {
		types.add(domain.topology.persistedAs);
		for (const key of Object.keys(domain.topology.edges ?? {})) ranges.set(key, "iri");
	}
	return { relRange: (rel) => ranges.get(rel), isType: (name) => types.has(name) };
}

/** Get all persisted domains (those whose topology marks them as persisted) as an array. */
export function getPersistedDomains(domains: Record<string, TRegisteredDomain>): Array<TRegisteredDomain & { topology: THypermediaTopology }> {
	return Object.values(domains).filter((d): d is TRegisteredDomain & { topology: THypermediaTopology } => isPersisted(d.topology));
}

/** (Re)register the `persisted-type` domain used by the generic graph steps' `{label: persisted-type}` argument.
 * Validation is OPEN, any non-empty type name is accepted, because the store, not a compiled enum, is the source of
 * truth for what exists: persisted data of a type declared in an earlier session (the `set of …` declaration is
 * session-only, its data is not) must stay explorable, and a absent type resolves to "not found" at the store
 * rather than a validation error. Known types reach autocomplete through the concern catalog / site metadata, so the
 * generalized graph/column views never need every type enumerated here. */
export const refreshHypermediaTypeDomain = (world: TWorld) => {
	world.domains[asDomainKey([DOMAIN_PERSISTED_TYPE])] = toRegisteredDomain({
		selectors: [DOMAIN_PERSISTED_TYPE],
		schema: z.string().min(1),
		description: "Persisted type",
	});
};
