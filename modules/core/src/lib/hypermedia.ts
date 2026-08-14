/**
 * Hypermedia concern catalog — canonical contract between server and SPA.
 *
 * Grounded in ActivityStreams / JSON-LD.  Derived entirely from getConcerns domains
 * with TDomainTopology: one declaration drives CRUD, JSON-LD context, and UI behaviour.
 *
 * StepDiscovery (step.list) embeds a ConcernCatalog so any client (shu, MCP, ...)
 * receives machine-readable hypermedia metadata without a separate RPC call.
 */

import { z } from "zod";
import { edgeRel, REL_CONTEXT, LinkRelations, BODY_LABEL, getRelRange, propertyIriOf, isPersisted, type TPropertyDef, type TRel, type THypermediaTopology } from "./resources.js";

/** Resolve a property def to its rel, regardless of plain-string or object (content / term) form. */
export function relOf(def: TPropertyDef): TRel {
	return typeof def === "string" ? def : (def.rel as TRel);
}

/** Schema field kinds that are queryable by their nature — bounded values a store can index and compare.
 *  A string is queryable only as a CONTEXT facet, never from its type. */
const BOUNDED_PRIMITIVE_KINDS = new Set(["number", "int", "boolean", "date", "enum", "literal"] as const);
export type TBoundedPrimitiveKind = typeof BOUNDED_PRIMITIVE_KINDS extends Set<infer K> ? K : never;

/** THE classification of a schema field's queryable kind (wrapper-unwrapped; a safe-int number reports "int").
 *  Consumers that must agree — the offered surface here, a store's column mapping — all read this one function. */
export function boundedPrimitiveKind(field: z.ZodType): TBoundedPrimitiveKind | undefined {
	const { inner } = unwrap(field);
	const def = (inner as { _zod?: { def?: { type?: string; format?: string } } })._zod?.def;
	if (def?.type === "number" && def.format === "safeint") return "int";
	return def?.type !== undefined && (BOUNDED_PRIMITIVE_KINDS as Set<string>).has(def.type) ? (def.type as TBoundedPrimitiveKind) : undefined;
}

/** The queryable surface of a persisted type, from its declaration alone: declared sortColumns, CONTEXT facets,
 *  the GENERATED_AT_TIME field, and bounded primitive schema fields. The identifier is excluded — an id
 *  dereferences, it is not searched. Every layer that offers or accepts field queries reads this one derivation,
 *  so what a client is offered is what a store accepts. */
export function queryableFields(domain: { schema: z.ZodType | undefined; topology: THypermediaTopology }): string[] {
	const topology = domain.topology;
	const out = new Set<string>(Object.keys(topology.sortColumns ?? {}));
	for (const [field, def] of Object.entries(topology.properties)) {
		const rel = relOf(def);
		if (rel === LinkRelations.CONTEXT.rel || rel === LinkRelations.GENERATED_AT_TIME.rel) out.add(field);
	}
	if (domain.schema instanceof z.ZodObject) {
		for (const [field, zodField] of Object.entries(domain.schema.shape as Record<string, z.ZodType>)) if (boundedPrimitiveKind(zodField) !== undefined) out.add(field);
	}
	out.delete(topology.id);
	return [...out].sort();
}

/** A rel's declared `rdfs:subPropertyOf` parent(s) (the canonical LinkRelations declaration), mapped to their term
 *  strings; undefined when the rel declares none. Mirrors the `subClassOf` lookup the type node emits — so a served
 *  JSON-LD context carries the genuine rel hierarchy (e.g. `schema:author rdfs:subPropertyOf hbn:inRoleOf`). */
function subPropertyOfRel(rel: string): string | string[] | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
	}
	return undefined;
}
import { HAIBUN_NS, type TRegisteredDomain } from "./resources.js";
import { unwrap } from "./zod-unwrap.js";
import { ellipsize } from "./util/index.js";

/** Per-schema JSON-Schema memoization. `step.list` RPC calls buildConcernCatalog repeatedly; each
 *  domain's `z.toJSONSchema` traversal is stable per schema instance, so cache by identity. */
const jsonSchemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();
function toJsonSchemaCached(schema: z.ZodType): Record<string, unknown> {
	const hit = jsonSchemaCache.get(schema);
	if (hit) return hit;
	try {
		const js = z.toJSONSchema(schema) as Record<string, unknown>;
		jsonSchemaCache.set(schema, js);
		return js;
	} catch {
		const empty: Record<string, unknown> = {};
		jsonSchemaCache.set(schema, empty);
		return empty;
	}
}

// ============================================================================
// Schemas  (Zod → TypeScript, Zod → JSON Schema — single source of truth)
// ============================================================================

const relValues = Object.values(LinkRelations).map((lr) => lr.rel) as [string, ...string[]];
export const RelSchema = z.enum(relValues);

/** A single persisted-domain property mapped to its ActivityStreams predicate. */
const PropertyConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
});
type TPropertyConcern = z.infer<typeof PropertyConcernSchema>;

/** An outgoing edge with its vocabulary term, classifying rel, and target persisted label. A consumer-declared edge
 *  carries its genuine term (the TEdgeDef iri) under an upper-ontology rel; `rolePriority` orders actor edges. */
const EdgeConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
	target: z.string(),
	rolePriority: z.number().optional(),
	/** Declared display phrase for the edge (rdfs:label), e.g. a consumer's "Issued by". */
	label: z.string().optional(),
	/** The noun a party displays under when it is this edge's TARGET: `X issuer→ P` makes P an "Issuer". Declared
	 *  beside the edge that confers the role, so a view reads what a party is called rather than holding a list. */
	roleNoun: z.string().optional(),
});
type TEdgeConcern = z.infer<typeof EdgeConcernSchema>;

/** Complete hypermedia description of a persisted type. */
const HypermediaConcernSchema = z.object({
	domainKey: z.string(),
	label: z.string(),
	idField: z.string(),
	/** ActivityStreams @type  e.g. "as:Note" */
	asType: z.string().optional(),
	/** JSON Schema derived from the Zod domain schema at registration time. */
	jsonSchema: z.record(z.string(), z.unknown()),
	properties: z.record(z.string(), PropertyConcernSchema),
	edges: z.record(z.string(), EdgeConcernSchema).default({}),
	/** Fields the server will accept as query filters (the topology's sortColumns). */
	queryable: z.array(z.string()).default([]),
	/** The field carrying the type's VALID time — when the thing happened in the world (an email's received time, a
	 *  file's own date; the declared defaultSort), as distinct from generatedAtTime, its INDEXED time. Every time-aware
	 *  consumer reads this one derivation, so an individual places by its own time unless indexed time is asked for. */
	validTimeField: z.string(),
	/** The property type (rel) whose value titles this type — the vocabulary's own labeling property
	 *  (`topology.displayLabel`), resolved through the rel when its range is iri. Absent for a type titled by the
	 *  cross-domain rdfs:label / as:name / content. */
	displayLabel: z.string().optional(),
	/** True when declared at runtime (`set of {domain} by …`) vs by a compiled stepper. */
	declared: z.boolean().default(false),
	/** UI metadata: slot, component, JS source, etc. */
	ui: z.record(z.string(), z.unknown()).optional(),
	/** The domain's human description, surfaced so the client can show what a type is. */
	description: z.string(),
});
type THypermediaConcern = z.infer<typeof HypermediaConcernSchema>;

/**
 * Reference-domain concern — a non-persisted composite whose `topology.ranges.id`
 * points at a persisted domain. The client uses this to recognise inputs that
 * should render as a persisted-individual picker instead of a typed-from-scratch composite.
 * Built by `individualRefDomain(refKey, targetKey)` in `domains.ts`.
 */
const ReferenceConcernSchema = z.object({
	refDomain: z.string(),
	targetDomain: z.string(),
	targetPersistedAs: z.string().optional(),
});
type TReferenceConcern = z.infer<typeof ReferenceConcernSchema>;

/** All concerns emitted by a running server. */
export const ConcernCatalogSchema = z.object({
	persisted: z.record(z.string(), HypermediaConcernSchema),
	references: z.record(z.string(), ReferenceConcernSchema).default({}),
});
export type TConcernCatalog = z.infer<typeof ConcernCatalogSchema>;

// ============================================================================
// Builder
// ============================================================================

/**
 * Build a ConcernCatalog from world.domains after getConcerns has run.
 * Non-persisted domains (no topology.persistedAs) are skipped.
 * Persisted domains are validated: id, properties, and valid rels are required.
 */
export function buildConcernCatalog(domains: Record<string, TRegisteredDomain>): TConcernCatalog {
	const persisted: Record<string, THypermediaConcern> = {};

	for (const [domainKey, domain] of Object.entries(domains)) {
		if (!isPersisted(domain.topology)) continue;
		const topology = domain.topology;
		const label = topology.persistedAs;

		if (!topology.id) throw new Error(`persisted domain "${label}" (${domainKey}) is missing required "id" field`);
		if (!topology.properties || Object.keys(topology.properties).length === 0) throw new Error(`persisted domain "${label}" (${domainKey}) has no properties`);

		const propertiesByRel = new Map<string, string[]>();
		for (const [field, def] of Object.entries(topology.properties)) {
			const rel = relOf(def);
			const list = propertiesByRel.get(rel) ?? [];
			list.push(field);
			propertiesByRel.set(rel, list);
		}

		const identifierFields = propertiesByRel.get(LinkRelations.IDENTIFIER.rel) ?? [];
		if (identifierFields.length === 0) throw new Error(`persisted domain "${label}" (${domainKey}) has no property with rel "${LinkRelations.IDENTIFIER.rel}"`);

		const generatedFields = propertiesByRel.get(LinkRelations.GENERATED_AT_TIME.rel) ?? [];
		if (generatedFields.length === 0) throw new Error(`persisted domain "${label}" (${domainKey}) has no property with rel "${LinkRelations.GENERATED_AT_TIME.rel}"`);
		if (generatedFields.length > 1)
			throw new Error(
				`persisted domain "${label}" (${domainKey}) declares ${generatedFields.length} properties with rel "${LinkRelations.GENERATED_AT_TIME.rel}": ${generatedFields.join(", ")}; expected exactly one`,
			);
		const generatedField = generatedFields[0];
		if (domain.schema instanceof z.ZodObject) {
			const fieldSchema = domain.schema.shape[generatedField];
			if (!fieldSchema) throw new Error(`persisted domain "${label}" (${domainKey}) maps generatedAtTime rel to "${generatedField}" but the schema has no such field`);
			const probe = fieldSchema.safeParse(undefined);
			if (probe.success && probe.data === undefined)
				throw new Error(`persisted domain "${label}" (${domainKey}) generatedAtTime field "${generatedField}" is .optional() — must be required or have a default`);
		}

		const properties: Record<string, TPropertyConcern> = {};
		for (const [field, propDef] of Object.entries(topology.properties)) {
			const rel = relOf(propDef);
			if (!REL_CONTEXT[rel]) throw new Error(`persisted domain "${label}" property "${field}" has unknown rel "${rel}"`);
			properties[field] = { term: propertyIriOf(propDef) ?? REL_CONTEXT[rel], rel };
		}

		const edges: Record<string, TEdgeConcern> = {};
		for (const [edgeField, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edgeField);
			if (!rel) throw new Error(`persisted domain "${label}" edge "${edgeField}" has no rel — add to EdgePredicates or provide explicit rel`);
			if (!REL_CONTEXT[rel]) throw new Error(`persisted domain "${label}" edge "${edgeField}" has unknown rel "${rel}"`);
			edges[edgeField] = {
				term: edgeDef.iri ?? REL_CONTEXT[rel],
				rel,
				target: edgeDef.range,
				...(edgeDef.rolePriority !== undefined ? { rolePriority: edgeDef.rolePriority } : {}),
				...(edgeDef.label !== undefined ? { label: edgeDef.label } : {}),
				...(edgeDef.roleNoun !== undefined ? { roleNoun: edgeDef.roleNoun } : {}),
			};
		}

		assertBoundPrefixes(label, domainKey, topology);

		if (topology.displayLabel !== undefined) {
			const carriers = [...Object.values(properties).map((p) => p.rel), ...Object.values(edges).map((e) => e.rel)];
			if (!carriers.includes(topology.displayLabel))
				throw new Error(`persisted domain "${label}" (${domainKey}) declares displayLabel "${topology.displayLabel}" but has no property or edge with that rel`);
		}

		// The domain's own description, carried onto its served schema: a type describes itself ONCE, and every surface —
		// the type's view, a product's `_description`, a step's tool schema — reads that one text. A `.describe()` on the
		// schema would be a second answer to the same question, free to drift from the one a reader is shown. Spread, never
		// mutated: toJsonSchemaCached memoizes by schema identity, and schemas are shared.
		const jsonSchema = { ...toJsonSchemaCached(domain.schema), description: domain.description };

		persisted[label] = HypermediaConcernSchema.parse({
			domainKey,
			label,
			idField: topology.id,
			...(topology.type ? { asType: topology.type } : {}),
			jsonSchema,
			properties,
			edges,
			...(topology.displayLabel ? { displayLabel: topology.displayLabel } : {}),
			queryable: queryableFields({ schema: domain.schema, topology }),
			validTimeField: topology.defaultSort ?? LinkRelations.GENERATED_AT_TIME.rel,
			declared: !!domain.ui?.declared,
			...(domain.ui ? { ui: domain.ui } : {}),
			description: domain.description,
		});
	}

	// Reference domains: non-persisted composites whose `topology.ranges.id`
	// points at a persisted domain. The client looks them up by domain key when
	// rendering a step input so it can present an "existing individual" picker
	// instead of requiring the composite to be constructed from scratch.
	const references: Record<string, TReferenceConcern> = {};
	for (const [domainKey, domain] of Object.entries(domains)) {
		if (!domain.topology || isPersisted(domain.topology)) continue;
		const ranges = (domain.topology as { ranges?: Record<string, string> }).ranges;
		const targetDomain = ranges?.id;
		if (!targetDomain) continue;
		const target = domains[targetDomain];
		if (!target || !isPersisted(target.topology)) continue;
		references[domainKey] = { refDomain: domainKey, targetDomain, targetPersistedAs: target.topology.persistedAs };
	}

	return { persisted, references };
}

// ============================================================================
// Inverse of the @context emission: a JSON-LD @context → a persisted domain's
// topology + Zod schema, so a type can be declared in a feature (`set of {domain} by …`)
// instead of a bespoke stepper. A type IS a domain with a hypermedia topology.
// ============================================================================

const IRI_TO_REL: Record<string, TRel> = Object.fromEntries(Object.entries(REL_CONTEXT).map(([rel, iri]) => [iri, rel as TRel]));

type TContextEntry = string | { "@id": string; "@type"?: string; range?: string };
export type THypermediaContext = { "@context": Record<string, TContextEntry>; "@queryable"?: string[] };

/** A JSON-LD node object: an optional `@context`, an optional `@id`/`@type`, and any number of term→value entries. THE
 *  one shape every linked-data projection in the system produces — a served vertex, a view's `summarizeForKihan`, the
 *  chat pane manifest, the graph export — so they share this contract instead of each being `unknown`. The `@context`
 *  form reuses {@link THypermediaContext}'s, plus the string-URL and array forms a 1.1 processor accepts. */
export type TLinkedData = {
	"@context"?: THypermediaContext["@context"] | string | ReadonlyArray<THypermediaContext["@context"] | string>;
	"@id"?: string;
	"@type"?: string | string[];
	[term: string]: unknown;
};

/** Type hint (xsd / primitive) → {zod, sql}. Defaults to string/TEXT. */
const TYPE_KINDS: Record<string, { zod: () => z.ZodType; sql: string }> = {
	"xsd:integer": { zod: () => z.number(), sql: "BIGINT" },
	"xsd:decimal": { zod: () => z.number(), sql: "DOUBLE PRECISION" },
	"xsd:double": { zod: () => z.number(), sql: "DOUBLE PRECISION" },
	"xsd:boolean": { zod: () => z.boolean(), sql: "BOOLEAN" },
	"xsd:date": { zod: () => z.string(), sql: "TIMESTAMP" },
	"xsd:dateTime": { zod: () => z.string(), sql: "TIMESTAMP" },
};
const kindOf = (typeHint?: string) => (typeHint && TYPE_KINDS[typeHint]) || { zod: () => z.string(), sql: "TEXT" };

/**
 * Build a persisted domain's topology + schema from a JSON-LD `@context` (inverse of the emission above).
 * The field mapped to `@id` is the identifier (required — a persisted type is invalid without one);
 * entries with a `range` are edges; others are properties whose rel comes from the IRI (canonical
 * REL_CONTEXT vocabulary). `published` (structural timeline field) is auto-injected if absent;
 * `@queryable` fields become typed sortColumns.
 */
export function hypermediaDomainFromContext(domainName: string, doc: THypermediaContext): { topology: THypermediaTopology; schema: z.ZodType } {
	const ctx = doc["@context"] ?? {};
	const properties: Record<string, TRel> = {};
	const edges: Record<string, { range: string; rel: TRel }> = {};
	const fields: Record<string, z.ZodType> = {};
	const sqlKinds: Record<string, string> = {};
	let idField: string | undefined;
	for (const [field, entry] of Object.entries(ctx)) {
		const obj = typeof entry === "string" ? { "@id": entry } : entry;
		if (obj["@id"] === "@id") {
			idField = field;
			properties[field] = LinkRelations.IDENTIFIER.rel;
			fields[field] = z.string().min(1);
			continue;
		}
		const rel = IRI_TO_REL[obj["@id"]];
		if (!rel) throw new Error(`set of ${domainName}: unknown rel IRI "${obj["@id"]}" for "${field}" (not in the link-relation vocabulary)`);
		if (obj.range) {
			edges[field] = { range: obj.range, rel };
			continue;
		}
		const kind = kindOf(obj["@type"]);
		properties[field] = rel;
		fields[field] = kind.zod();
		sqlKinds[field] = kind.sql;
	}
	if (!idField) throw new Error(`set of ${domainName}: declaration needs an @id field — a type is invalid without an identifier`);
	if (!Object.values(properties).includes(LinkRelations.GENERATED_AT_TIME.rel)) {
		properties.generatedAtTime = LinkRelations.GENERATED_AT_TIME.rel;
		// A real ISO timestamp, not "" — the quad/timeline path parses this field and rejects empty.
		fields.generatedAtTime = z.string().default(() => new Date().toISOString());
		sqlKinds.generatedAtTime = "TIMESTAMP";
	}
	const queryable = doc["@queryable"] ?? [];
	const sortColumns = Object.fromEntries(queryable.map((f) => [f, sqlKinds[f] ?? "TEXT"]));
	const topology: THypermediaTopology = {
		persistedAs: domainName,
		id: idField,
		properties,
		...(Object.keys(edges).length ? { edges } : {}),
		...(queryable.length ? { sortColumns } : {}),
	};
	return { topology, schema: z.object(fields).strict() };
}

// ============================================================================
// Resource rels — rel-to-field lookups per persisted type
// ============================================================================

/** Rel-to-field lookup for resource types. Derived from topology at runtime. */
export type ResourceRels = {
	types: string[];
	field(type: string, rel: string): string | undefined;
	idField(type: string): string;
	createdField(type: string): string;
	nameField(type: string): string | undefined;
	contentField(type: string): string | undefined;
	/** The property type (rel) this type declares as its labeling property, where its vocabulary designates one. */
	displayLabelRel(type: string): TRel | undefined;
	fields(type: string): Record<string, string>;
	schema(type: string): z.ZodType;
};

/** Build ResourceRels from world.domains concern metadata. */
export function buildResourceRels(domains: Record<string, TRegisteredDomain>): ResourceRels {
	const types: string[] = [];
	const idFields = new Map<string, string>();
	const relMaps = new Map<string, Record<string, string>>();
	const schemas = new Map<string, z.ZodType>();
	const displayLabelRels = new Map<string, TRel>();

	for (const domain of Object.values(domains)) {
		if (!isPersisted(domain.topology)) continue;
		const topology = domain.topology;
		const type = topology.persistedAs;
		types.push(type);
		idFields.set(type, topology.id);
		schemas.set(type, domain.schema);
		if (topology.displayLabel) displayLabelRels.set(type, topology.displayLabel);
		const rels: Record<string, string> = {};
		for (const [field, def] of Object.entries(topology.properties ?? {})) {
			rels[field] = relOf(def);
		}
		// Universal rdfs:label: every persisted type may carry a `label` that titles it (the explicit, type-agnostic
		// display label — the affordance for naming a name-less instance, e.g. a Principal/DID). Injected only when the
		// type neither declares a `label` field nor already maps another field to rdfs:label; inert until a vertex sets it.
		if (rels.label === undefined && !Object.values(rels).includes(LinkRelations.LABEL.rel)) rels.label = LinkRelations.LABEL.rel;
		relMaps.set(type, rels);
	}

	const fieldByRel = (type: string, rel: string): string | undefined => {
		const rels = relMaps.get(type);
		if (!rels) return undefined;
		for (const [field, r] of Object.entries(rels)) {
			if (r === rel) return field;
		}
		return undefined;
	};

	return {
		types,
		field: fieldByRel,
		idField: (type) => {
			const id = idFields.get(type);
			if (!id) throw new Error(`Unknown resource type: ${type}`);
			return id;
		},
		createdField: (type) => {
			const f = fieldByRel(type, LinkRelations.GENERATED_AT_TIME.rel);
			if (!f) throw new Error(`Persisted type "${type}" has no property mapped to ${LinkRelations.GENERATED_AT_TIME.rel}`);
			return f;
		},
		nameField: (type) => fieldByRel(type, LinkRelations.NAME.rel),
		contentField: (type) => fieldByRel(type, LinkRelations.CONTENT.rel),
		displayLabelRel: (type) => displayLabelRels.get(type),
		fields: (type) => relMaps.get(type) ?? {},
		schema: (type) => {
			const s = schemas.get(type);
			if (!s) throw new Error(`Unknown resource type: ${type}`);
			return s;
		},
	};
}

/**
 * Property rels searched to derive an individual's display label, split by strength.
 * HEADLINE rels (LABEL, NAME, CONTENT) are the node's own title, returned bare. LABEL
 * (rdfs:label) is first: the explicit, type-agnostic display label any resource may carry
 * — it applies where the AS `name` doesn't (a Principal/DID, a cross-vocab node) and an
 * explicit label deliberately overrides the entity's name. WEAK rels (seqPath, schemaObject,
 * context) are provenance pointers, returned prefixed (`field: value`) since the value alone
 * isn't self-describing — they only label a node that has nothing better. `composeDisplayLabel`
 * slots the linked-body preview BETWEEN them: a body-backed node (e.g. a Comment with a
 * seqPath) is titled by its body, never by its seqPath. Shared by every cluster producer so
 * priorities can't drift.
 */
/** rdfs:label alone — the reader's explicit display label, which outranks even the type's own declared labeling property. */
const DISPLAY_LABEL_EXPLICIT: ReadonlyArray<{ rel: string; bare: boolean }> = [{ rel: LinkRelations.LABEL.rel, bare: true }];
/** The cross-domain title rels every domain shares, resolved when a type designates no labeling property of its own. */
const DISPLAY_LABEL_SHARED: ReadonlyArray<{ rel: string; bare: boolean }> = [
	{ rel: LinkRelations.NAME.rel, bare: true },
	{ rel: LinkRelations.CONTENT.rel, bare: true },
];
const DISPLAY_LABEL_HEADLINE: ReadonlyArray<{ rel: string; bare: boolean }> = [...DISPLAY_LABEL_EXPLICIT, ...DISPLAY_LABEL_SHARED];
const DISPLAY_LABEL_WEAK: ReadonlyArray<{ rel: string; bare: boolean }> = [
	{ rel: LinkRelations.SEQ_PATH.rel, bare: false },
	{ rel: LinkRelations.SCHEMA_OBJECT.rel, bare: false },
	{ rel: LinkRelations.CONTEXT.rel, bare: false },
];
/** Full priority (headline then weak) — the legacy single-list resolution order. */
export const DISPLAY_LABEL_REL_PRIORITY: ReadonlyArray<{ rel: string; bare: boolean }> = [...DISPLAY_LABEL_HEADLINE, ...DISPLAY_LABEL_WEAK];

/**
 * Whether a declared label resolves THROUGH the property, to the label of the individual it points at, rather than
 * reading the property's own value. The rel's declared range decides, so a type states only WHICH property titles it,
 * never how that property resolves.
 */
export const displayLabelResolvesThrough = (rel: string): boolean => getRelRange(rel) === "iri";

/** Maximum length for a display label (bytes/chars). Truncated values are suffixed with an ellipsis. */
export const MAX_DISPLAY_LABEL_LEN = 80;

function resolveFromCandidates(
	rels: Record<string, string> | undefined,
	getProperty: (field: string) => unknown,
	candidates: ReadonlyArray<{ rel: string; bare: boolean }>,
): string | undefined {
	if (!rels) return undefined;
	const fieldByRel = new Map<string, string>();
	for (const [field, rel] of Object.entries(rels)) {
		if (!fieldByRel.has(rel)) fieldByRel.set(rel, field);
	}
	for (const candidate of candidates) {
		const field = fieldByRel.get(candidate.rel);
		if (!field) continue;
		const value = getProperty(field);
		if (value === undefined || value === null || value === "") continue;
		return candidate.bare ? String(value) : `${field}: ${value}`;
	}
	return undefined;
}

/**
 * Resolve a display label for an individual by walking `DISPLAY_LABEL_REL_PRIORITY`
 * against `getProperty(field)`. Returns the first non-empty value or undefined.
 * Server-side callers pass a closure over the individual row; client-side callers
 * pass a closure over the property quads.
 */
export function resolveDisplayLabel(rels: Record<string, string> | undefined, getProperty: (field: string) => unknown): string | undefined {
	return resolveFromCandidates(rels, getProperty, DISPLAY_LABEL_REL_PRIORITY);
}

/** Clamp a label to MAX_DISPLAY_LABEL_LEN — the one `ellipsize` every producer shares, after trimming. */
export function clampDisplayLabel(s: string): string {
	return ellipsize(s.trim(), MAX_DISPLAY_LABEL_LEN);
}

/** Shortest non-empty trimmed string — the concise linked-body summary, not a large signed or encoded blob. */
function shortestBody(values: ReadonlyArray<string | null | undefined>): string | undefined {
	let best: string | undefined;
	for (const v of values) {
		const s = typeof v === "string" ? v.trim() : "";
		if (s && (best === undefined || s.length < best.length)) best = s;
	}
	return best;
}

/**
 * The single rule for a node's display label, used by every cluster producer (quad
 * stores and the live-snapshot merge) so a node's title can never differ between
 * views. Priority: the reader's explicit rdfs:label → the type's own declared labeling
 * property (`topology.displayLabel`) → the shared headline (NAME/CONTENT) → the shortest
 * linked-body preview → a weak provenance pointer (seqPath/schemaObject/context) → the
 * subject id. The body outranks the weak pointers so a body-backed node (e.g. a Comment
 * carrying a seqPath) is titled by its body, not "seqPath: …". Always returns a non-empty,
 * length-bounded string.
 *
 * `displayLabel` is the type's declaration resolved for THIS node: `linkedLabel` for an
 * iri-ranged rel (the label of the individual it points at, which the caller reads — a
 * proxy is titled by what it stands for), otherwise the rel's own value off this node.
 * A type that declares none is unaffected; nothing here knows any type by name.
 */
export function composeDisplayLabel(args: {
	rels: Record<string, string> | undefined;
	getProperty: (field: string) => unknown;
	bodyContents?: ReadonlyArray<string | null | undefined>;
	displayLabel?: { rel: string; linkedLabel?: string };
	id: string;
}): string {
	const explicit = resolveFromCandidates(args.rels, args.getProperty, DISPLAY_LABEL_EXPLICIT);
	const declared = explicit ? undefined : resolveDeclaredLabel(args);
	const shared = explicit || declared ? undefined : resolveFromCandidates(args.rels, args.getProperty, DISPLAY_LABEL_SHARED);
	const headline = explicit ?? declared ?? shared;
	const body = headline ? undefined : shortestBody(args.bodyContents ?? []);
	const weak = headline || body ? undefined : resolveFromCandidates(args.rels, args.getProperty, DISPLAY_LABEL_WEAK);
	return clampDisplayLabel(headline ?? body ?? weak ?? args.id);
}

/** The type's declared labeling property resolved to text: through the edge for an iri-ranged rel, else its own value. */
function resolveDeclaredLabel(args: {
	rels: Record<string, string> | undefined;
	getProperty: (field: string) => unknown;
	displayLabel?: { rel: string; linkedLabel?: string };
}): string | undefined {
	const declared = args.displayLabel;
	if (!declared) return undefined;
	if (displayLabelResolvesThrough(declared.rel)) return declared.linkedLabel?.trim() || undefined;
	return resolveFromCandidates(args.rels, args.getProperty, [{ rel: declared.rel, bare: true }]);
}

/**
 * Contents of a subject's linked Body sub-resources, gathered from quads already in
 * memory: for each `hasBody` edge (object typed as the body label) look up that body's
 * content via `contentOfBody`. Feeds `composeDisplayLabel` where the preview must come
 * from quads rather than a server-side index.
 */
export function linkedBodyContents(
	subjectQuads: ReadonlyArray<{ object: unknown; objectType?: string }>,
	contentOfBody: (bodySubject: string) => string | undefined,
	bodyLabel: string = BODY_LABEL,
): string[] {
	const out: string[] = [];
	for (const q of subjectQuads) {
		if (q.objectType !== bodyLabel || typeof q.object !== "string") continue;
		const c = contentOfBody(q.object);
		if (typeof c === "string" && c.length > 0) out.push(c);
	}
	return out;
}

type LabelQuad = { predicate: string; object: unknown; objectType?: string };

/**
 * Display label for a subject from quads alone — the one quad-based label builder shared by every
 * quad-holding producer (the in-memory store and the live-snapshot merge), so they can't drift.
 * `bodyContentOf` resolves a linked Body subject to its content; `rels` is the field→rel map (absent
 * where no concern catalog is loaded — then only the body preview and id apply).
 */
export function displayLabelForQuads(
	type: string,
	subject: string,
	subjectQuads: ReadonlyArray<LabelQuad>,
	bodyContentOf: (bodySubject: string) => string | undefined,
	rels: Record<string, string> | undefined,
	declared?: { rel: string; linkedLabel?: string },
): string {
	const bodyContents = type === BODY_LABEL ? [] : linkedBodyContents(subjectQuads, bodyContentOf);
	const getProperty = (field: string) => subjectQuads.find((q) => q.predicate === field && (typeof q.object === "string" || typeof q.object === "number"))?.object;
	return composeDisplayLabel({ rels, getProperty, bodyContents, id: subject, ...(declared ? { displayLabel: declared } : {}) });
}

/** Parse a value as epoch ms (ISO date string or number). */
export function parseTimestampValue(val: unknown): number | null {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const d = new Date(val);
		if (!Number.isNaN(d.getTime())) return d.getTime();
	}
	return null;
}

// ============================================================================
// JSON-LD context — derived from domain topology
// ============================================================================

/**
 * Map a rel's RDF range to its UI rendering category.
 *   iri       → "item"    (navigable link to another individual)
 *   container → "select"  (multi-valued structure; select-like control)
 *   literal   → "filter"  (scalar value; filter/text control)
 *
 * Unknown rels default to "filter" — the safest neutral rendering.
 */
function linkRelFromSemantic(rel: string): "item" | "filter" | "select" {
	const range = getRelRange(rel);
	if (range === "iri") return "item";
	if (range === "container") return "select";
	return "filter";
}

/** The CURIE prefix a term names, or "" for a bare local name or an absolute IRI (neither of which binds a vocabulary). */
function curiePrefix(term: string): string {
	if (term.startsWith("http://") || term.startsWith("https://")) return "";
	const colon = term.indexOf(":");
	return colon > 0 ? term.slice(0, colon) : "";
}

/**
 * A type may not claim a term in a vocabulary it has not bound. Every CURIE a topology uses — its class (`type`), the
 * classes it says it is a kind of (`subClassOf`), and the genuine IRIs its properties/edges declare — must resolve
 * through a prefix core binds (STANDARD_NAMESPACES + hbn) or one the type declares itself (`topology.namespaces`).
 *
 * Unbound, the prefix still serves: `getJsonLdContext` emits the term and the reader's JSON-LD resolves it to nothing —
 * a claim about a standard that no processor can follow, and nothing says so. The rel checks beside this one already
 * hold a type to its own vocabulary; this holds it to the standards it names.
 */
function assertBoundPrefixes(label: string, domainKey: string, topology: THypermediaTopology): void {
	const bound = new Set([...Object.keys(STANDARD_NAMESPACES), "hbn", ...Object.keys(topology.namespaces ?? {})]);
	const claims: Array<[string, string]> = [];
	if (topology.type) claims.push(["type", topology.type]);
	for (const superClass of [topology.subClassOf ?? []].flat()) claims.push(["subClassOf", superClass]);
	for (const [field, def] of Object.entries(topology.properties)) {
		const iri = propertyIriOf(def);
		if (iri) claims.push([`property "${field}"`, iri]);
	}
	for (const [edgeField, edgeDef] of Object.entries(topology.edges ?? {})) {
		if (edgeDef.iri) claims.push([`edge "${edgeField}"`, edgeDef.iri]);
	}
	for (const [where, term] of claims) {
		const prefix = curiePrefix(term);
		if (prefix && !bound.has(prefix))
			throw new Error(
				`persisted domain "${label}" (${domainKey}) ${where} names "${term}", but the "${prefix}:" vocabulary is not bound — declare it in topology.namespaces so the served @context resolves it`,
			);
	}
}

/** The vocabularies core itself binds: the standards every domain may name, without declaring them. A consumer's own
 *  prefixes are NOT here — each domain declares those in `topology.namespaces`. ONE source, so what is served and what
 *  `assertBoundPrefixes` accepts cannot drift: a prefix that resolves in the context is exactly one a type may use. */
const STANDARD_NAMESPACES: Record<string, string> = {
	as: "https://www.w3.org/ns/activitystreams#",
	foaf: "http://xmlns.com/foaf/0.1/",
	dcterms: "http://purl.org/dc/terms/",
	prov: "https://www.w3.org/ns/prov#",
	sec: "https://w3id.org/security#",
	sosa: "http://www.w3.org/ns/sosa/",
	schema: "https://schema.org/",
	oa: "http://www.w3.org/ns/oa#",
	cito: "http://purl.org/spar/cito/",
	earl: "http://www.w3.org/ns/earl#",
	otel: "https://opentelemetry.io/schemas/",
	rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
	rdfs: "http://www.w3.org/2000/01/rdf-schema#",
};

/** Build JSON-LD context from domain topology. Derives URI mappings from domain property rels. */
export function getJsonLdContext(domains: Record<string, TRegisteredDomain>, haibunNs: string = HAIBUN_NS): Record<string, unknown> {
	const context: Record<string, unknown> = {
		"@version": 1.1,
		...STANDARD_NAMESPACES,
		hbn: haibunNs,
	};
	// JSON-LD 1.1 type-scoped context. Each @type carries a nested @context mapping ITS field/edge terms to the genuine
	// IRIs its own rels declare, so a field name reused across domains (e.g. "expires", "author", "type") resolves to the
	// CORRECT IRI under each type — honoring the per-domain rel (which also drives column-view presentation: filter via
	// CONTEXT, id via IDENTIFIER, item/select via linkRelFromSemantic) without a flat global collision.
	//
	// A term is ALSO emitted at the top level as a fallback for a type-less reference, but ONLY when every domain that
	// declares it agrees on the same @id. A term that maps to differing IRIs across domains (e.g. `author` → schema:author
	// in one type but as:tag in another) is left OUT of the top level: a last-wins emission there would be
	// non-deterministic (registration order decides the winner) and could give a type-less reference the wrong IRI. Such
	// a term is still resolved correctly under each type's scoped @context, which is what a 1.1 processor applies.
	// The @context holds ONLY JSON-LD term definitions (a term → its IRI, `@type: @id` for links, a type-scoped @context).
	// The ontology it describes — the rdfs:subClassOf / rdfs:subPropertyOf axioms and haibun's own `hbn:rel` presentation
	// hint — are NOT term-definition keywords, so they are emitted as real RDF nodes in a sibling `@graph`, keeping the
	// context a valid JSON-LD 1.1 context while the same document still carries the vocabulary's ontology.
	const topTerm = new Map<string, { node: Record<string, string>; consistent: boolean }>();
	const offerTopTerm = (key: string, node: Record<string, string>): void => {
		const prior = topTerm.get(key);
		if (!prior) topTerm.set(key, { node, consistent: true });
		else if (prior.node["@id"] !== node["@id"]) prior.consistent = false;
	};
	const iriRef = (x: string | string[]): unknown => (Array.isArray(x) ? x.map((v) => ({ "@id": v })) : { "@id": x });
	// One RDF Property node per vocabulary IRI: its rel-derived presentation hint (hbn:rel) and its rdfs:subPropertyOf axiom.
	const propNodes = new Map<string, Record<string, unknown>>();
	const declareProp = (iri: string, hbnRel: string, subProperty: string | string[] | undefined): void => {
		if (propNodes.has(iri)) return;
		const node: Record<string, unknown> = { "@id": iri, "@type": "rdf:Property", "hbn:rel": hbnRel };
		if (subProperty !== undefined) node["rdfs:subPropertyOf"] = iriRef(subProperty);
		propNodes.set(iri, node);
	};
	const subPropertyAxiom = (rel: string | undefined): string | string[] | undefined => {
		const sp = rel ? subPropertyOfRel(rel) : undefined;
		if (sp === undefined) return undefined;
		return Array.isArray(sp) ? sp.map((p) => REL_CONTEXT[p as TRel] ?? `hbn:${p}`) : (REL_CONTEXT[sp as TRel] ?? `hbn:${sp}`);
	};
	const classNodes: Array<Record<string, unknown>> = [];
	for (const domain of Object.values(domains)) {
		if (!isPersisted(domain.topology)) continue;
		const topology = domain.topology;
		// A type's own vocabulary prefixes (CURIEs its @types/rels use beyond the standards + haibun's own), merged into the
		// served context. First declaration wins; core declares none of these itself.
		for (const [prefix, iri] of Object.entries(topology.namespaces ?? {})) context[prefix] ??= iri;
		const scoped: Record<string, unknown> = {};
		const put = (key: string, node: Record<string, string>): void => {
			scoped[key] = node;
			offerTopTerm(key, node);
		};
		for (const [prop, def] of Object.entries(topology.properties)) {
			const rel = relOf(def);
			// A property's genuine vocabulary IRI wins over its rel's default — so a standards field carries its real term
			// (a consumer-declared iri) rather than the placeholder a catch-all rel (CONTEXT/TAG) would give it.
			const uri = propertyIriOf(def) ?? REL_CONTEXT[rel] ?? `hbn:${prop}`;
			const linkRel = linkRelFromSemantic(rel);
			const node: Record<string, string> = { "@id": uri };
			if (linkRel === "item") node["@type"] = "@id";
			put(prop, node);
			declareProp(uri, linkRel, subPropertyAxiom(rel));
		}
		for (const [edge, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edge);
			const uri = edgeDef.iri ?? (rel && REL_CONTEXT[rel]) ?? `hbn:${edge}`;
			put(edge, { "@id": uri, "@type": "@id" });
			// The edge's subPropertyOf: the topology may declare it per-edge (the discourse rels do — subPropertyOf inReplyTo)
			// OR the rel itself declares it in LinkRelations (the role rels — subPropertyOf inRoleOf). Either is a genuine axiom.
			const declared = (edgeDef as { subPropertyOf?: string | string[] }).subPropertyOf ?? subPropertyAxiom(rel);
			declareProp(uri, "item", declared);
		}
		// The bare type label maps to its vocabulary IRI PLUS the type-scoped @context above (so `@type: "Person"` resolves to
		// e.g. `foaf:Person` and activates Person's term scope). A type conforming to published standard context(s) references
		// them as a JSON-LD 1.1 array with the standard URLs LAST, so the official term mappings stay authoritative (a later
		// context wins): this type's own ADDITIONAL field terms come first and survive only where the standard defines nothing,
		// never overriding a term the standard's own context defines. Absent, the scoped object stands alone.
		const typeContext = topology.standardContexts?.length ? [scoped, ...topology.standardContexts] : scoped;
		const typeIri = topology.type ?? `hbn:${topology.persistedAs}`;
		context[topology.persistedAs] = { "@id": typeIri, "@context": typeContext };
		// The class node in @graph carries the rdfs:subClassOf axiom — a REAL ontology statement, not a context term keyword —
		// so e.g. `sec:Controller rdfs:subClassOf prov:Agent` makes attribution (prov:wasAttributedTo, range prov:Agent) into it well-formed.
		const classNode: Record<string, unknown> = { "@id": typeIri, "@type": "rdfs:Class" };
		if (topology.subClassOf) classNode["rdfs:subClassOf"] = iriRef(topology.subClassOf);
		classNodes.push(classNode);
	}
	for (const [key, { node, consistent }] of topTerm) {
		if (consistent) context[key] = node;
	}
	return { "@context": context, "@graph": [...classNodes, ...propNodes.values()] };
}
