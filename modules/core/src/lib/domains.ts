import { z } from "zod";
import { isVertexTopology, type TDomainDefinition, type TRegisteredDomain, type TVertexTopology } from "./resources.js";
import type { TWorld } from "./world.js";

export const DOMAIN_STATEMENT = "statement";
export const DOMAIN_STRING = "string";
export const DOMAIN_LINK = "link";
export const DOMAIN_NUMBER = "number";
export const DOMAIN_JSON = "json";
export const DOMAIN_DATE = "date";
export const BASE_TYPES = [DOMAIN_STRING, DOMAIN_LINK, DOMAIN_NUMBER, DOMAIN_DATE, DOMAIN_STATEMENT, DOMAIN_JSON];

// Event domains (used as quad predicate in the observation/event named graph).
export const DOMAIN_LIFECYCLE_EVENT = "lifecycle-event";
export const DOMAIN_INFRASTRUCTURE_ERROR = "infrastructure-error";
export const DOMAIN_CAPABILITY_DENIAL = "capability-denial";

// Test-only escape hatch. Steps in tests that don't yet have a registered output
// domain can declare `productsDomain: DOMAIN_TEST_SCRATCH` to satisfy the dispatcher
// without first registering a typed schema. Production steps must use a real domain.
export const DOMAIN_TEST_SCRATCH = "test-scratch";

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
 * Schema for a vertex reference — a single-field composite that carries just
 * the referenced vertex's id. Steps whose action only needs the id of an
 * existing vertex use this so the resolver can chain through that vertex's
 * producers (or fact-bind an existing instance) without forcing the full
 * vertex payload through dispatch.
 */
export const vertexRefSchema = z.object({ id: z.string() }).strict();
export type TVertexRef = z.infer<typeof vertexRefSchema>;

/**
 * Normalise a value to `{ id }`. Step actions whose input is a
 * `vertexRefDomain` use this in lieu of accessing `.id` directly: the
 * feature-file dispatch path resolves a bare-name variable through that
 * variable's STORED domain (typically `string`), so the action receives the
 * raw id string rather than the `{id}` object the RPC path produces. Calling
 * `asVertexRef` is idempotent — accepts an id string, a full vertex (extracts
 * `id`), or an already-normalised `{id}` ref.
 */
export function asVertexRef(value: unknown): TVertexRef {
	if (typeof value === "string") return { id: value };
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		if (typeof obj.id === "string") return { id: obj.id };
	}
	throw new Error(`asVertexRef: cannot normalise ${typeof value} to a vertex reference; expected an id string or an object with an "id" string`);
}

/**
 * Build a reusable "reference to vertex X" input domain. The resulting
 * `TDomainDefinition` registers `refKey` as a composite with one `id` field
 * whose range is `targetKey` (a registered vertex domain). The composite-
 * decomposition layer then treats the field as either a fact-binding (an
 * existing X) or a chain through X's producer steps.
 *
 * The coercer accepts a JSON-stringified `{id}` (what `objectCoercer` does)
 * or a bare id string (test ergonomics: `revokeCredential({ credential: "`x.id`" })`).
 * Either form is normalised to `{ id }` so the action's parameter is the same
 * regardless of how the test or UI supplied the reference.
 */
export function vertexRefDomain(refKey: string, targetKey: string, description?: string): TDomainDefinition {
	return {
		selectors: [refKey],
		schema: vertexRefSchema,
		coerce: (proto) => {
			const v = (proto as { value?: unknown }).value;
			// String: an id directly, or a JSON-stringified `{id}` ref.
			if (typeof v === "string") {
				const trimmed = v.trim();
				if (trimmed.startsWith("{")) {
					const parsed = JSON.parse(trimmed) as Record<string, unknown>;
					if (typeof parsed?.id === "string") return { id: parsed.id };
					throw new Error(`vertex ref expected an "id" string; got ${trimmed.slice(0, 120)}`);
				}
				return { id: v };
			}
			// Object: accept either a {id} ref or a full vertex (extract .id).
			// Without the extraction path, a test that passes the whole
			// resolved-variable vertex (the common haibun pattern) would
			// fail strict parsing.
			if (v && typeof v === "object") {
				const obj = v as Record<string, unknown>;
				if (typeof obj.id === "string") return { id: obj.id };
			}
			throw new Error(`vertex ref expects a string id or an object with an "id" string; got ${typeof v}`);
		},
		description: description ?? `Reference to a ${targetKey} by id`,
		topology: { ranges: { id: targetKey } },
	};
}

/** Build a Map from vertexLabel → TRegisteredDomain for all vertex domains. Returned domains carry a TVertexTopology so consumers can read id/properties/edges without narrowing. */
export function vertexDomainMap(domains: Record<string, TRegisteredDomain>): Map<string, TRegisteredDomain & { topology: TVertexTopology }> {
	const map = new Map<string, TRegisteredDomain & { topology: TVertexTopology }>();
	for (const domain of Object.values(domains)) {
		if (isVertexTopology(domain.topology)) map.set(domain.topology.vertexLabel, domain as TRegisteredDomain & { topology: TVertexTopology });
	}
	return map;
}

/** Get all vertex domains (those whose topology promotes them to a vertex) as an array. */
export function getVertexDomains(domains: Record<string, TRegisteredDomain>): Array<TRegisteredDomain & { topology: TVertexTopology }> {
	return Object.values(domains).filter((d): d is TRegisteredDomain & { topology: TVertexTopology } => isVertexTopology(d.topology));
}
