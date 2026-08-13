import { z } from "zod";
import { DOMAIN_PERSISTED_TYPE, isPersisted, LinkRelations, type TDomainDefinition, type TRegisteredDomain, type THypermediaTopology, type TRelRange } from "./resources.js";
import type { TLinkVocabulary } from "./typed-links.js";
import type { TWorld } from "./world.js";

export const DOMAIN_STATEMENT = "statement";
export const DOMAIN_STRING = "string";
export const DOMAIN_LINK = "link";
export const DOMAIN_NUMBER = "number";
export const DOMAIN_JSON = "json";
export const DOMAIN_DATE = "date";
export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_DATE, DOMAIN_STATEMENT, DOMAIN_JSON];

// Goal resolver domains.
export const DOMAIN_DOMAIN_KEY = "domain-key";
export const DOMAIN_GOAL_RESOLUTION = "goal-resolution";
export const DOMAIN_MICHI = "michi";
export const DOMAIN_AFFORDANCES = "affordances";
export const DOMAIN_CHAIN_LINT = "domain-chain-lint";

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

export const asDomainKey = (domains: string[]) => domains?.sort().join(" | ");

export const normalizeDomainKey = (domain: string) => {
	// Split on ' | ' (union separator), not on '/' which is used in variable names
	const parts = domain
		?.split(" | ")
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

export const toRegisteredDomain = (definition: TDomainDefinition): TRegisteredDomain => ({
	selectors: [...definition.selectors],
	schema: definition.schema,
	coerce: definition.coerce ?? ((proto) => definition.schema.parse(proto.value)),
	comparator: definition.comparator,
	values: definition.values,
	description: definition.description,
	stepperName: definition.stepperName,
	topology: definition.topology,
	ui: definition.ui,
});

export const mapDefinitionsToDomains = (definitions: TDomainDefinition[]) => {
	return definitions.reduce<Record<string, TRegisteredDomain>>((acc, definition) => {
		const domainKey = asDomainKey(definition.selectors);
		acc[domainKey] = toRegisteredDomain(definition);
		return acc;
	}, {});
};

/** Coercer: JSON-parses strings, validates with schema. Used by haibun domain coercion for object-typed params. */
export function objectCoercer<T extends z.ZodType>(schema: T) {
	return (proto: { value?: unknown }) => {
		const value = typeof proto.value === "string" ? JSON.parse(proto.value) : proto.value;
		return schema.parse(value);
	};
}

/**
 * Schema for an individual reference — a single-field composite that carries just
 * the referenced individual's id. Steps whose action only needs the id of an
 * existing individual use this so the resolver can chain through that individual's
 * producers (or fact-bind an existing instance) without forcing the full
 * individual payload through dispatch.
 */
export const individualRefSchema = z.object({ id: z.string() }).strict();
export type TIndividualRef = z.infer<typeof individualRefSchema>;

/**
 * Normalise a value to `{ id }`. Step actions whose input is an
 * `individualRefDomain` use this in lieu of accessing `.id` directly: the
 * feature-file dispatch path resolves a bare-name variable through that
 * variable's STORED domain (typically `string`), so the action receives the
 * raw id string rather than the `{id}` object the RPC path produces. Calling
 * `asIndividualRef` is idempotent — accepts an id string, a full individual (extracts
 * `id`), or an already-normalised `{id}` ref.
 */
export function asIndividualRef(value: unknown): TIndividualRef {
	if (typeof value === "string") return { id: value };
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (typeof obj.id === "string") return { id: obj.id };
	}
	throw new Error(`asIndividualRef: cannot normalise ${typeof value} to an individual reference; expected an id string or an object with an "id" string`);
}

/**
 * Build a reusable "reference to individual X" input domain. The resulting
 * `TDomainDefinition` registers `refKey` as a composite with one `id` field
 * whose range is `targetKey` (a registered persisted domain). The composite-
 * decomposition layer then treats the field as either a fact-binding (an
 * existing X) or a chain through X's producer steps.
 *
 * The coercer accepts a JSON-stringified `{id}` (what `objectCoercer` does)
 * or a bare id string (test ergonomics: `revokeCredential({ credential: "`x.id`" })`).
 * Either form is normalised to `{ id }` so the action's parameter is the same
 * regardless of how the test or UI supplied the reference.
 */
export function individualRefDomain(refKey: string, targetKey: string, description?: string): TDomainDefinition {
	return {
		selectors: [refKey],
		schema: individualRefSchema,
		coerce: (proto) => {
			const v = (proto as { value?: unknown }).value;
			// String: an id directly, or a JSON-stringified `{id}` ref.
			if (typeof v === "string") {
				const trimmed = v.trim();
				if (trimmed.startsWith("{")) {
					const parsed = JSON.parse(trimmed) as Record<string, unknown>;
					if (typeof parsed?.id === "string") return { id: parsed.id };
					throw new Error(`individual ref expected an "id" string; got ${trimmed.slice(0, 120)}`);
				}
				return { id: v };
			}
			// Object: accept either a {id} ref or a full individual (extract .id).
			// Without the extraction path, a test that passes the whole
			// resolved-variable individual (the common haibun pattern) would
			// fail strict parsing.
			if (v && typeof v === "object") {
				const obj = v as Record<string, unknown>;
				if (typeof obj.id === "string") return { id: obj.id };
			}
			throw new Error(`individual ref expects a string id or an object with an "id" string; got ${typeof v}`);
		},
		description: description ?? `Reference to a ${targetKey} by id`,
		topology: { ranges: { id: targetKey } },
	};
}

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
 * Validation is OPEN — any non-empty type name is accepted — because the store, not a compiled enum, is the source of
 * truth for what exists: persisted data of a type declared in an earlier session (the `set of …` declaration is
 * session-only, its data is not) must stay explorable, and a truly absent type resolves to "not found" at the store
 * rather than a validation error. Known types reach autocomplete through the concern catalog / site metadata, so the
 * generalized graph/column views never need every type enumerated here. */
export const refreshHypermediaTypeDomain = (world: TWorld) => {
	world.domains[asDomainKey([DOMAIN_PERSISTED_TYPE])] = toRegisteredDomain({
		selectors: [DOMAIN_PERSISTED_TYPE],
		schema: z.string().min(1),
		description: "Persisted type",
	});
};
