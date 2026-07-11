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
import {
	edgeRel,
	REL_CONTEXT,
	LinkRelations,
	BODY_LABEL,
	getRelRange,
	isContentPropertyDef,
	isPersisted,
	type TPropertyDef,
	type TRel,
	type THypermediaTopology,
} from "./resources.js";

/** Resolve a property def to its rel, regardless of plain-string or content-object form. */
export function relOf(def: TPropertyDef): TRel {
	return isContentPropertyDef(def) ? (def.rel as TRel) : def;
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
 *  JSON-LD context carries the genuine rel hierarchy (e.g. `cred:issuer rdfs:subPropertyOf hbn:inRoleOf`). */
function subPropertyOfRel(rel: string): string | string[] | undefined {
	for (const entry of Object.values(LinkRelations)) {
		if (entry.rel === rel) return (entry as { subPropertyOf?: string | string[] }).subPropertyOf;
	}
	return undefined;
}
import { HAIBUN_NS, type TRegisteredDomain } from "./resources.js";
import { unwrap } from "./composite-domain.js";
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

/** An outgoing edge with its ActivityStreams predicate and target persisted label. */
const EdgeConcernSchema = z.object({
	term: z.string(),
	rel: RelSchema,
	target: z.string(),
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
			properties[field] = { term: REL_CONTEXT[rel], rel };
		}

		const edges: Record<string, TEdgeConcern> = {};
		for (const [edgeField, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edgeField);
			if (!rel) throw new Error(`persisted domain "${label}" edge "${edgeField}" has no rel — add to EdgePredicates or provide explicit rel`);
			if (!REL_CONTEXT[rel]) throw new Error(`persisted domain "${label}" edge "${edgeField}" has unknown rel "${rel}"`);
			edges[edgeField] = { term: REL_CONTEXT[rel], rel, target: edgeDef.range };
		}

		const jsonSchema = toJsonSchemaCached(domain.schema);

		persisted[label] = HypermediaConcernSchema.parse({
			domainKey,
			label,
			idField: topology.id,
			...(topology.type ? { asType: topology.type } : {}),
			jsonSchema,
			properties,
			edges,
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
	fields(type: string): Record<string, string>;
	schema(type: string): z.ZodType;
};

/** Build ResourceRels from world.domains concern metadata. */
export function buildResourceRels(domains: Record<string, TRegisteredDomain>): ResourceRels {
	const types: string[] = [];
	const idFields = new Map<string, string>();
	const relMaps = new Map<string, Record<string, string>>();
	const schemas = new Map<string, z.ZodType>();

	for (const domain of Object.values(domains)) {
		if (!isPersisted(domain.topology)) continue;
		const topology = domain.topology;
		const type = topology.persistedAs;
		types.push(type);
		idFields.set(type, topology.id);
		schemas.set(type, domain.schema);
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
const DISPLAY_LABEL_HEADLINE: ReadonlyArray<{ rel: string; bare: boolean }> = [
	{ rel: LinkRelations.LABEL.rel, bare: true },
	{ rel: LinkRelations.NAME.rel, bare: true },
	{ rel: LinkRelations.CONTENT.rel, bare: true },
];
const DISPLAY_LABEL_WEAK: ReadonlyArray<{ rel: string; bare: boolean }> = [
	{ rel: LinkRelations.SEQ_PATH.rel, bare: false },
	{ rel: LinkRelations.SCHEMA_OBJECT.rel, bare: false },
	{ rel: LinkRelations.CONTEXT.rel, bare: false },
];
/** Full priority (headline then weak) — the legacy single-list resolution order. */
export const DISPLAY_LABEL_REL_PRIORITY: ReadonlyArray<{ rel: string; bare: boolean }> = [...DISPLAY_LABEL_HEADLINE, ...DISPLAY_LABEL_WEAK];

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
 * views. Priority: the node's own headline (NAME/CONTENT) → the shortest linked-body
 * preview → a weak provenance pointer (seqPath/schemaObject/context) → the subject id.
 * The body outranks the weak pointers so a body-backed node (e.g. a Comment carrying a
 * seqPath) is titled by its body, not "seqPath: …". Always returns a non-empty,
 * length-bounded string.
 */
export function composeDisplayLabel(args: {
	rels: Record<string, string> | undefined;
	getProperty: (field: string) => unknown;
	bodyContents?: ReadonlyArray<string | null | undefined>;
	id: string;
}): string {
	const headline = resolveFromCandidates(args.rels, args.getProperty, DISPLAY_LABEL_HEADLINE);
	const body = headline ? undefined : shortestBody(args.bodyContents ?? []);
	const weak = headline || body ? undefined : resolveFromCandidates(args.rels, args.getProperty, DISPLAY_LABEL_WEAK);
	return clampDisplayLabel(headline ?? body ?? weak ?? args.id);
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
): string {
	const bodyContents = type === BODY_LABEL ? [] : linkedBodyContents(subjectQuads, bodyContentOf);
	const getProperty = (field: string) => subjectQuads.find((q) => q.predicate === field && (typeof q.object === "string" || typeof q.object === "number"))?.object;
	return composeDisplayLabel({ rels, getProperty, bodyContents, id: subject });
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

/** Build JSON-LD context from domain topology. Derives URI mappings from domain property rels. */
export function getJsonLdContext(domains: Record<string, TRegisteredDomain>): Record<string, unknown> {
	const context: Record<string, unknown> = {
		"@version": 1.1,
		as: "https://www.w3.org/ns/activitystreams#",
		foaf: "http://xmlns.com/foaf/0.1/",
		dcterms: "http://purl.org/dc/terms/",
		prov: "https://www.w3.org/ns/prov#",
		sec: "https://w3id.org/security#",
		cred: "https://www.w3.org/2018/credentials#",
		sosa: "http://www.w3.org/ns/sosa/",
		schema: "https://schema.org/",
		oa: "http://www.w3.org/ns/oa#",
		otel: "https://opentelemetry.io/schemas/",
		rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
		rdfs: "http://www.w3.org/2000/01/rdf-schema#",
		// W3C Bitstring Status List vocabulary (the status-list credential terms, distinct from the core credentials vocabulary).
		vcstatus: "https://www.w3.org/ns/credentials/status#",
		hbn: HAIBUN_NS,
		haibun: "/ns/",
	};
	// JSON-LD 1.1 type-scoped context. Each @type carries a nested @context mapping ITS field/edge terms to the genuine
	// IRIs its own rels declare, so a field name reused across domains (e.g. "expires", "issuer", "type") resolves to the
	// CORRECT IRI under each type — honoring the per-domain rel (which also drives column-view presentation: filter via
	// CONTEXT, id via IDENTIFIER, item/select via linkRelFromSemantic) without a flat global collision.
	//
	// A term is ALSO emitted at the top level as a fallback for a type-less reference, but ONLY when every domain that
	// declares it agrees on the same @id. A term that maps to differing IRIs across domains (e.g. `issuer` → cred:issuer
	// in a credential but as:tag in a trusted-list) is left OUT of the top level: a last-wins emission there would be
	// non-deterministic (registration order decides the winner) and could give a type-less reference the wrong IRI. Such
	// a term is still resolved correctly under each type's scoped @context, which is what a 1.1 processor applies.
	const topTerm = new Map<string, { node: Record<string, string>; consistent: boolean }>();
	const offerTopTerm = (key: string, node: Record<string, string>): void => {
		const prior = topTerm.get(key);
		if (!prior) topTerm.set(key, { node, consistent: true });
		else if (prior.node["@id"] !== node["@id"]) prior.consistent = false;
	};
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
		// A rel's declared `subPropertyOf` parent(s), as the parents' genuine IRIs — the rdfs:subPropertyOf axiom emitted on
		// the rel's term node (the property analog of the type node's rdfs:subClassOf). So e.g. `cred:issuer` carries
		// `rdfs:subPropertyOf hbn:inRoleOf`, declaring the broad role super-property as a real ontology fact in the context.
		const subPropertyAxiom = (rel: string): string | string[] | undefined => {
			const sp = subPropertyOfRel(rel);
			if (sp === undefined) return undefined;
			return Array.isArray(sp) ? sp.map((p) => REL_CONTEXT[p as TRel] ?? `haibun:${p}`) : (REL_CONTEXT[sp as TRel] ?? `haibun:${sp}`);
		};
		for (const [prop, def] of Object.entries(topology.properties)) {
			const rel = relOf(def);
			const uri = REL_CONTEXT[rel] ?? `haibun:${prop}`;
			const linkRel = linkRelFromSemantic(rel);
			const node: Record<string, unknown> = { "@id": uri, "haibun:rel": linkRel };
			if (linkRel === "item") node["@type"] = "@id";
			const axiom = subPropertyAxiom(rel);
			if (axiom !== undefined) node["rdfs:subPropertyOf"] = axiom;
			put(prop, node as Record<string, string>);
		}
		for (const [edge, edgeDef] of Object.entries(topology.edges ?? {})) {
			const rel = edgeDef.rel ?? edgeRel(edge);
			const node: Record<string, unknown> = { "@id": (rel && REL_CONTEXT[rel]) ?? `haibun:${edge}`, "@type": "@id", "haibun:rel": "item" };
			// The edge's subPropertyOf: the topology may declare it per-edge (the discourse rels do — subPropertyOf inReplyTo)
			// OR the rel itself declares it in LinkRelations (the role rels — subPropertyOf inRoleOf). Either is a genuine axiom.
			const declared = (edgeDef as { subPropertyOf?: string | string[] }).subPropertyOf ?? (rel ? subPropertyOfRel(rel) : undefined);
			if (declared !== undefined) {
				node["rdfs:subPropertyOf"] = Array.isArray(declared)
					? declared.map((p) => REL_CONTEXT[p as TRel] ?? `haibun:${p}`)
					: (REL_CONTEXT[declared as TRel] ?? `haibun:${declared}`);
			}
			put(edge, node as Record<string, string>);
		}
		// The bare type label maps to its vocabulary IRI PLUS the type-scoped @context above (so `@type: "Person"`
		// resolves to e.g. `foaf:Person` and activates Person's term scope). A `subClassOf` topology declares the
		// genuine rdfs:subClassOf axiom on the type's class IRI — so e.g. `sec:Issuer rdfs:subClassOf prov:Agent`
		// makes `prov:wasAttributedTo` (range prov:Agent) into it well-formed, without multi-valuing the @type label.
		const typeNode: Record<string, unknown> = { "@id": topology.type ?? `haibun:${topology.persistedAs}`, "@context": scoped };
		if (topology.subClassOf) typeNode["rdfs:subClassOf"] = topology.subClassOf;
		context[topology.persistedAs] = typeNode;
	}
	for (const [key, { node, consistent }] of topTerm) {
		if (consistent) context[key] = node;
	}
	return { "@context": context };
}
