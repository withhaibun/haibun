import { itemAt } from "./util/item-at.js";
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
import { actionList } from "./actions.js";
import type { TWorld } from "./world.js";

export const DOMAIN_STATEMENT = "statement";
export const DOMAIN_STRING = "string";
/** Free text a person writes: a note, a question, a reason or a passage quoted, read as written. */
export const DOMAIN_TEXT = "text";
export const DOMAIN_LINK = "link";
export const DOMAIN_NUMBER = "number";
export const DOMAIN_JSON = "json";
/** A JSON object, given as its text or as the object: what a step that takes named values as data takes. */
export const DOMAIN_JSON_OBJECT = "json-object";
export const DOMAIN_DATE = "date";
/** The actions a caller holds or a delegation allows. */
export const DOMAIN_ACTIONS = "actions";
/** A reference to a Principal by its DID. */
export const DOMAIN_PRINCIPAL_REF = refDomainKey(PRINCIPAL_DOMAIN);
/** The id of a record of the type another of its step's parameters names (the step's `recordIds`). */
export const DOMAIN_RECORD_ID = "record-id";
const BASE_TYPES = [DOMAIN_STRING, DOMAIN_TEXT, DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_DATE, DOMAIN_STATEMENT, DOMAIN_JSON];

/** A registered domain's key. */
export const DOMAIN_DOMAIN_KEY = "domain-key";
/** The name of a variable, as the line writes it. */
export const DOMAIN_VARIABLE_NAME = "variable-name";
/** A length of time as a line writes it: a number and its unit, seconds or milliseconds, such as `2s` or `30 ms`. */
export const DURATION_TERM = /^(\d+(?:\.\d+)?)\s*(ms|s)$/;
/** The name a declaration gives a new domain, as the line writes it. */
export const DOMAIN_DOMAIN_NAME = "domain-name";
/** A loaded stepper's name. */
export const DOMAIN_STEPPER_NAME = "stepper-name";
/** A pattern in which `*` stands for any run of characters. */
export const DOMAIN_GLOB = "glob";
/** The title a feature, scenario, activity or waypoint is given, as the line writes it. */
export const DOMAIN_TITLE = "title";
/** An argument in a call to a waypoint, for a placeholder in the waypoint's outcome pattern. */
export const DOMAIN_WAYPOINT_ARGUMENT = "waypoint-argument";
/** The text of a line comment, after `;;`. */
export const DOMAIN_LINE_COMMENT = "line-comment";
/** A file or directory's path, as a storage or the file system reads it. */
export const DOMAIN_FILE_PATH = "file-path";
/** The path a web server serves something at, such as `/shu`. */
export const DOMAIN_ROUTE = "route";
/** A step's place in actuality: its dot-joined sequence path, such as `0.1.5.3`, or an id that begins with one. */
export const DOMAIN_STEP_PATH = "step-path";
/** A length of time, given as seconds or milliseconds, such as `2s` or `30 ms`, read as milliseconds. */
export const DOMAIN_DURATION = "duration";
/** A step as a call names it, its stepper and step joined by a hyphen, such as `Haibun-showSteps`. */
export const DOMAIN_STEP_METHOD = "step-method";
/** The id of a walk begun toward a goal, which each advance of it names. */
export const DOMAIN_WALK_ID = "walk-id";
/** A link relation, by the name a predicate carries it under, such as `cites`. */
export const DOMAIN_LINK_REL = "link-rel";
/** A value a variable holds or is given, of whatever domain the variable's is, which that domain reads. */
export const DOMAIN_VARIABLE_VALUE = "variable-value";
/** Text whose `#{name}` places a composition fills from variables, as the line writes it. */
export const DOMAIN_TEMPLATE = "template";
/** A declared type's hypermedia declaration, as the line writes it: its JSON-LD @context, or prose naming its fields. */
export const DOMAIN_HYPERMEDIA_DECLARATION = "hypermedia-declaration";
/** The members a bracketed list names, as the line writes them. */
export const DOMAIN_SET_VALUES = "set-values";
/** Step lines, in order, as a JSON array: the statements a saved activity runs. */
export const DOMAIN_STATEMENT_LINES = "statement-lines";
/** Types records persist as, given as a list. */
export const DOMAIN_PERSISTED_TYPES = "persisted-types";
/** The backgrounds a feature includes, by name, given as a list. */
export const DOMAIN_BACKGROUND_NAMES = "background-names";
/** A token whose holder is granted what it grants, sent as `Authorization: Bearer` (RFC 6750). */
export const DOMAIN_BEARER_TOKEN = "bearer-token";
/** The name an account signs in with. */
export const DOMAIN_USER_NAME = "user-name";
/** The secret an account signs in with. */
export const DOMAIN_PASSWORD = "password";

/** What separates the parts of a union domain's key. */
export const DOMAIN_UNION = " | ";

/** The domains a domain key names: itself, or each part of a union. */
export const domainParts = (domainKey: string): string[] => domainKey.split(DOMAIN_UNION);

/** Primitive domains: a caller supplies their values, a step doesn't produce one, and they aren't nodes of the typed
 *  step graph, since every step would connect through them. */
const PRIMITIVE_DOMAINS: ReadonlySet<string> = new Set<string>([
	...BASE_TYPES,
	DOMAIN_DOMAIN_KEY,
	DOMAIN_VARIABLE_NAME,
	DOMAIN_DOMAIN_NAME,
	DOMAIN_STEPPER_NAME,
	DOMAIN_GLOB,
	DOMAIN_FILE_PATH,
	DOMAIN_ROUTE,
	DOMAIN_TITLE,
]);

/** A glob as the source of an anchored regular expression that matches what it matches. */
export const globSource = (glob: string): string => `^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`;

/** Whether a domain key is primitive: a primitive, or a union with one, which a caller can always supply as it. */
export const isPrimitiveDomain = (domainKey: string): boolean => domainParts(domainKey).some((part) => PRIMITIVE_DOMAINS.has(part));

/** Whether a caller writes a value of the domain in a step's line, so a step doesn't need to produce it. A caller writes a
 *  primitive and a value domain that doesn't name a thing. A persisted type, or a reference to one, is a thing a step
 *  produces. A caller writes a composite whose fields name things, and a step that takes it takes what its fields name
 *  (`fieldRangesOf`). */
/** The domain `key` names, which `where` reads. A domain the loaded steppers don't register is refused, naming what read it. */
export function registeredDomain(domains: Record<string, TRegisteredDomain> | undefined, key: string, where: string): TRegisteredDomain {
	const domain = domains?.[key];
	if (!domain)
		throw new Error(
			`${where} names the domain "${key}", which the loaded steppers don't register. A domain is one a stepper declares in getConcerns, or a union of them registered as one.`,
		);
	return domain;
}

export const isWrittenByCaller = (domainKey: string, domains: Record<string, TRegisteredDomain>): boolean =>
	isPrimitiveDomain(domainKey) ||
	domainParts(domainKey).every((part) => domains[part] !== undefined && !isPersisted(domains[part].topology) && refTargetOf(domains[part], domains) === undefined);
export const DOMAIN_GOAL_RESOLUTION = "goal-resolution";
export const DOMAIN_MICHI = "michi";
export const DOMAIN_AFFORDANCES = "affordances";
export const DOMAIN_CHAIN_LINT = "domain-chain-lint";
export const DOMAIN_CHAIN_WALK = "chain-walk";

type TEnumDomainInput = {
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
	deriveNamingDomains(world.domains);
};

/** The type a reference domain refers to: the stored type its `topology.ranges.id` names, where the domain itself
 *  isn't stored as a type. Undefined for any other domain. */
export function refTargetOf(domain: TRegisteredDomain, domains: Record<string, TRegisteredDomain>): string | undefined {
	if (!domain.topology || isPersisted(domain.topology)) return undefined;
	const target = (domain.topology as { ranges?: Record<string, string> }).ranges?.id;
	return target !== undefined && isPersisted(domains[target]?.topology) ? target : undefined;
}

/** The domains that the fields of a caller's composite name, as its `topology.ranges` declares them. A persisted type and
 *  a reference don't name domains this way. */
export function fieldRangesOf(domain: TRegisteredDomain | undefined, domains: Record<string, TRegisteredDomain>): string[] {
	if (!domain?.topology || isPersisted(domain.topology) || refTargetOf(domain, domains) !== undefined) return [];
	return Object.values(domain.topology.ranges ?? {});
}

/** The key of the domain whose value is a reference to a record of the type a domain key names. */
export function refDomainKey(domainKey: string): string {
	return `${domainKey}-ref`;
}

/**
 * The domains that name what is registered, derived again whenever a domain is registered, so a type or a domain a
 * feature declares is named: for each type a record persists as, a reference to one of its records (`refDomainKey`);
 * `persisted-type`, the type a record persists as; and `domain-key`, every domain's key. The last two test membership
 * with `names` and don't list members, so a step taking one, as a model's prompt describes it, doesn't state a list of every type
 * or domain; `show domains` lists them. `persisted-type` is open to any type name, since the store holds what exists and
 * records of a type an earlier session declared stay readable; a bare word naming a declared type is that type.
 */
export const deriveNamingDomains = (domains: Record<string, TRegisteredDomain>) => {
	for (const [key, domain] of Object.entries(domains)) {
		const ref = refDomainKey(key);
		if (isPersisted(domain.topology)) domains[ref] = toRegisteredDomain(individualRefDomain(ref, key, `A reference to a ${domain.topology.persistedAs} by its id`));
	}
	const types = new Set(getPersistedDomains(domains).map((domain) => domain.topology.persistedAs));
	domains[DOMAIN_PERSISTED_TYPE] = toRegisteredDomain({
		selectors: [DOMAIN_PERSISTED_TYPE],
		schema: NameSchema,
		names: (term) => types.has(term),
		description: "The type a record persists as",
	});
	const registered = (key: string) => key !== DOMAIN_DOMAIN_KEY && domains[key] !== undefined;
	domains[DOMAIN_DOMAIN_KEY] = toRegisteredDomain({
		selectors: [DOMAIN_DOMAIN_KEY],
		schema: z.string().refine(registered, "doesn't name a registered domain; `show domains` lists them"),
		names: registered,
		description: "A registered domain's key; `show domains` lists them",
	});
	return domains;
};

/** A bare term naming a member of a domain: one of its values, or one its membership test holds for. */
export const namesMember = (domain: TRegisteredDomain | undefined, term: string): boolean => domain?.values?.includes(term) === true || domain?.names?.(term) === true;

/** The names of the loaded steppers, as the domain a step naming a stepper takes. */
export const registerStepperNames = (world: TWorld, names: string[]) => {
	world.domains[DOMAIN_STEPPER_NAME] = toRegisteredDomain(
		createEnumDomainDefinition({ name: DOMAIN_STEPPER_NAME, values: [...new Set(names)], description: "A loaded stepper's name" }),
	);
};

export const asDomainKey = (domains: string[]) => domains?.sort().join(DOMAIN_UNION);

/** The domain key a step parameter takes: the domain its phrase names, or `string` where it doesn't name one. A union's
 *  parts are in order. */
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

/** What a domain that holds a name takes: any text but empty. Every domain that holds a name declares this one schema. */
export const NameSchema = z.string().min(1, "is empty");

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
 * registered, and a declaration doesn't repeat it. A consumer reads the level from the `accessLevel` property alone, so the
 * property always has that name.
 */
function withLevelProperty(topology: TDomainTopology | undefined): TDomainTopology | undefined {
	if (!isPersisted(topology)) return topology;
	return { ...topology, properties: { ...topology.properties, accessLevel: LinkRelations.ACCESS_LEVEL.rel } };
}

export const toRegisteredDomain = (definition: TDomainDefinition): TRegisteredDomain => ({
	...definition,
	selectors: [...definition.selectors],
	coerce: definition.coerce ?? ((proto) => definition.schema.parse(proto.value)),
	topology: withLevelProperty(definition.topology),
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
export const individualRefInputSchema = z.preprocess((value, ctx) => {
	const given = typeof value === "string" && value.trimStart().startsWith("{") ? parseJsonText(value, ctx) : value;
	if (typeof given === "string") return { id: given };
	if (given && typeof given === "object" && typeof (given as { id?: unknown }).id === "string") return { id: (given as { id: string }).id };
	return given;
}, individualRefSchema);

/** A list as a caller gives it: an array, its JSON text, or text separated by commas, each member read by `member`. An
 *  empty list is refused. */
export const listedSchema = (member: z.ZodType<string>, what: string) =>
	z.preprocess(
		(value, ctx) => {
			if (typeof value !== "string") return value;
			return value.trimStart().startsWith("[") ? parseJsonText(value, ctx) : actionList(value);
		},
		z.array(member).min(1, `the list of ${what}s is empty`),
	);

const QUOTED_MEMBER = /"([^"]+)"/g;

/** The members a bracketed list writes: its quoted members, or else its words, separated by spaces or commas. */
export const parseQuotedOrWordList = (value: string): string[] => {
	const quoted = [...value.matchAll(QUOTED_MEMBER)].map((match) => itemAt(match, 1).trim()).filter(Boolean);
	if (quoted.length) return quoted;
	return value
		.split(/[\s,]+/)
		.map((token) => token.trim())
		.filter(Boolean);
};

/** The members a bracketed list writes, as a set's values read them. */
export const setValuesSchema = z.preprocess((value) => (typeof value === "string" ? parseQuotedOrWordList(value) : value), z.array(z.string()).min(1, "the set is empty"));

/** The backgrounds a `Backgrounds:` line includes, as its domain reads them. */
export const backgroundNamesSchema = listedSchema(z.string().min(1), "background");

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
