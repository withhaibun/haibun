/**
 * The quad and the reads of records: a quad's shape and the pattern that matches it, the graph query, the density query,
 * and the pages and samples a store returns. A quad carries properties, as a property-graph store's vertex carries them,
 * so a store with an engine writes a quad's properties as they are.
 */
import { z } from "zod";
import { AccessLevelSchema, AccessQueryLevelSchema, type AccessLevel } from "../../resources.js";
import { CountedFields, CountedSchema } from "../../hypermedia.js";

/**
 * The named graph of the variables actuality holds. The quad store reads it here, so it doesn't import feature-variables.
 */
export const SHARED_GRAPH = "variables";

// --- Graph query schema (core domain, used by any graph/quad query UI) ---

export const DOMAIN_GRAPH_QUERY = "graph-query";

export const SearchConditionSchema = z
	.object({
		predicate: z.string().min(1),
		operator: z.enum(["eq", "contains", "gt", "lt", "gte", "lte", "between", "in"]),
		value: z.string(),
		value2: z.string().optional(),
		/** The values of an `in` condition: the field holds any one of them. A view of three levels sends one condition with
		 *  three values in place of three conditions. */
		values: z.array(z.string()).optional(),
	})
	.strict();
export type TSearchCondition = z.infer<typeof SearchConditionSchema>;

/** How the words of a term combine. `every` reads the records that hold every word of the term, and `any` reads the records
 *  that hold one of its words. A search that narrows a set states `every`, and a question put to a search states `any`. */
export const TERM_WORDS = { every: "every", any: "any" } as const;
export type TTermWords = (typeof TERM_WORDS)[keyof typeof TERM_WORDS];

/** The directions of a page's sort. */
export const SortOrderSchema = z.enum(["asc", "desc"]);
export type TSortOrder = z.infer<typeof SortOrderSchema>;

/** One record by its type and id, and the relations a reference read follows from it. A read follows every relation where
 *  `via` is absent. */
const ReachedRecordSchema = z.object({ label: z.string(), id: z.string(), via: z.array(z.string()).min(1).optional() });

export const GraphQuerySchema = z
	.object({
		label: z.string().optional(),
		/** The conditions each record of the page satisfies. A read without conditions reads every record of its type. */
		filters: z.array(SearchConditionSchema).optional(),
		textQuery: z.string().optional(),
		/** The types a text query without a label reads. A query that doesn't name one reads every type the store searches, as a
		 *  query without a label doesn't name one type. */
		types: z.array(z.string()).optional(),
		/** How the words of `textQuery` combine. A term that doesn't state it reads the records that hold every word. */
		words: z.enum([TERM_WORDS.every, TERM_WORDS.any]).optional(),
		/** Names the field that orders a page of one type. A page without it takes the type's default sort. */
		sortBy: z.string().min(1).optional(),
		/** The direction of the sort. A page that doesn't state it sorts descending, the latest first. */
		sortOrder: SortOrderSchema.optional(),
		/** The records of a page. A store's `pageLimit` rejects a limit outside 1 to `MAX_PAGE_ROWS`, so one rule bounds every read.
		 *  A read that doesn't state a limit reads a page of `PAGE_ROWS`. */
		limit: z.number().int().optional(),
		/** The position of the page's first record. A read that doesn't state an offset reads from the first record. */
		offset: z.number().int().nonnegative().optional(),
		/** The first records of each type, in place of `limit` and `offset`. `pageLimit` bounds it as it bounds `limit`. */
		perType: z.number().int().optional(),
		/** The ceiling of the count, from 1 to `COUNT_CEILING`. A count stops at `COUNT_CEILING` where the query doesn't state one. */
		countTo: z.number().int().optional(),
		// The schema doesn't state a level where the query doesn't: each read determines what an unstated level reads. A graph
		// query reads every level its reader holds, and a shape query refuses an unstated level.
		accessLevel: AccessQueryLevelSchema.optional(),
		fields: z.array(z.string()).optional(),
		/** When true, the page states the plan of its query. */
		explain: z.boolean().optional(),
		/** When true, the read doesn't count the records past the page, and `total` states the page's length. */
		skipCount: z.boolean().optional(),
		/** The record whose referencing records this query reads, through the relations `via` names or through every relation.
		 *  A term, a label and a label's filters narrow the referencing records. A question that names a party, a type and a
		 *  subject is one read. */
		references: ReachedRecordSchema.optional(),
		/** The record whose referenced records this query reads, through the relations `via` names or through every relation. */
		referencedBy: ReachedRecordSchema.optional(),
		/** The ids of the records to read, in the order of the page. A named read states the type of its records in `label`. */
		named: z.array(z.string().min(1)).min(1).optional(),
	})
	.strict();
export type TGraphQuery = z.infer<typeof GraphQuerySchema>;
/** A graph query as a caller states it, before the schema parses it. */
export type TGraphQueryInput = z.input<typeof GraphQuerySchema>;

/** The records of a page whose read doesn't state a limit. */
export const PAGE_ROWS = 50;
/** The direction a page sorts in where its read doesn't state one: descending, the latest first. */
const UNSTATED_SORT_ORDER: TSortOrder = "desc";

/** A graph query with each part a store reads stated. */
export type TStatedQuery = TGraphQuery & Required<Pick<TGraphQuery, "filters" | "words" | "sortOrder" | "limit" | "offset" | "explain" | "skipCount">>;

/** A graph query with each part it doesn't state read by its rule: without a filter it reads every record, a term reads the
 *  records that hold every word, a page sorts descending, a page holds `PAGE_ROWS` records from the first, and a read
 *  counts its records and doesn't state its plan. Every store reads a query through this one function. */
export function statedQuery(query: TGraphQuery): TStatedQuery {
	const { filters, words, sortOrder, limit, offset } = query;
	return {
		...query,
		filters: filters === undefined ? [] : filters,
		words: words === undefined ? TERM_WORDS.every : words,
		sortOrder: sortOrder === undefined ? UNSTATED_SORT_ORDER : sortOrder,
		limit: limit === undefined ? PAGE_ROWS : limit,
		offset: offset === undefined ? 0 : offset,
		explain: query.explain === true,
		skipCount: query.skipCount === true,
	};
}

/**
 * How many records fall in each division of a span of time, by how each turned out.
 *
 * A view of actuality over a span of any length shows its shape rather than its rows: the span divides into a fixed
 * number of buckets, and each bucket states how many records of each group it holds. The result holds that many buckets
 * whatever the span, so a read of an hour and a read of a decade take the same time and return the same size.
 */
export const DOMAIN_DENSITY_QUERY = "density-query";

export const DensityQuerySchema = z
	.object({
		label: z.string().min(1),
		/** The field whose instant places a record in a bucket. */
		timeField: z.string().min(1),
		/** The span, as instants a record's own field compares against. The last bucket includes `to`. */
		from: z.string().min(1),
		to: z.string().min(1),
		/** How many divisions the span has. The result holds this many, whatever the span. */
		buckets: z.number().int().positive(),
		/** The field a bucket's counts are grouped by: how a record turned out. A record that doesn't state it counts
		 *  under the empty group, so a bucket's counts always add up to what it holds. */
		groupBy: z.string().min(1),
		/** The conditions each counted record satisfies. A read without conditions counts every record of its type. */
		filters: z.array(SearchConditionSchema).optional(),
		accessLevel: AccessQueryLevelSchema.optional(),
	})
	.strict();
export type TDensityQuery = z.infer<typeof DensityQuerySchema>;

/** One entry per bucket, oldest first, each counting its records by group. A bucket that doesn't hold a record is an empty
 *  entry, so the result's length is the bucket count the read states and a view draws the gaps. A bucket's own span is the
 *  span divided by the count, which every reader derives the same way, so the result doesn't state it per bucket. */
export const DensityResultSchema = z.object({ buckets: z.array(z.record(z.string(), z.number().int().nonnegative())) });
export type TDensityResult = z.infer<typeof DensityResultSchema>;

/** The distinct values of one property, in order, and their count to `COUNT_CEILING`. A saturated count states that more
 *  values exist than the list holds. */
export const DistinctValuesSchema = z.object({ values: z.array(z.string()), ...CountedFields });
export type TDistinctValues = z.infer<typeof DistinctValuesSchema>;

/** The keys that order a page besides a field: the record's id, its type, a search's score and the order of a named read. */
export const ORDER_KEY = { id: "@id", type: "@type", score: "score", named: "named" } as const;
const OrderKeySchema = z.object({ key: z.string(), order: SortOrderSchema });
export type TOrderKey = z.infer<typeof OrderKeySchema>;

/** The field of a reference read's record that lists the relations that reach the record. */
export const VIA_FIELD = "_via";

/** The page a graph query returns: its records, their count, and what a store with a query engine adds about the read. The
 *  site's step and a page that reads its own copy return this one shape. */
export const GraphQueryResultSchema = z.object({
	vertices: z.array(z.record(z.string(), z.unknown())),
	...CountedFields,
	cypher: z.string().optional(),
	queryPlan: z.string().optional(),
	sort: z
		.object({
			fields: z.array(z.string()).describe("The fields this label accepts as `sortBy`. A view renders a sort control for these fields only."),
			orders: z.array(SortOrderSchema).describe("The sort directions this label accepts as `sortOrder`."),
			current: z
				.object({ field: z.string().optional(), order: SortOrderSchema })
				.describe("The sort this response applied. The response omits `field` where the read orders rows by relevance or in the store's order."),
		})
		.optional(),
	order: z.array(OrderKeySchema).optional().describe("The keys that order the page. The last key is `@id`, so each record holds one position."),
	perType: z.record(z.string(), CountedSchema).optional().describe("The count of each type, on a page of the first records of each type."),
});
export type TGraphQueryResult = z.infer<typeof GraphQueryResultSchema>;

/** A page that `readRecords` returns. It states its order. */
export type TRecordsPage = TGraphQueryResult & { order: TOrderKey[] };

/** One edge of an individual: what it is, which way it points, and the record it names. */
export const QuadEdgeSchema = z.object({ type: z.string(), direction: z.enum(["out", "in"]), target: z.record(z.string(), z.unknown()) });
export type TQuadEdge = z.infer<typeof QuadEdgeSchema>;

/** The edges that point at one individual and how many there are. Each edge carries the record at its other end. */
export const IncomingEdgesSchema = z.object({ edges: z.array(QuadEdgeSchema), ...CountedFields });
export type TIncomingEdges = z.infer<typeof IncomingEdgesSchema>;

/** An individual as a view reads it: the record, the edges either way, and how many edges point at it. A site reading its
 *  own store and a page reading what it holds return this one shape. */
export const IndividualWithEdgesSchema = z.object({ vertex: z.record(z.string(), z.unknown()), edges: z.array(QuadEdgeSchema), incomingCount: CountedSchema });
export type TIndividualWithEdges = z.infer<typeof IndividualWithEdgesSchema>;

export interface TQuad {
	subject: string;
	predicate: string;
	object: unknown;
	namedGraph: string;
	/** The declared type of an edge's target. A renderer resolves the edge to the node of that type and id, since one id can
	 *  name records of several types, such as a DID that names a Principal and an Issuer. */
	objectType?: string;
	timestamp: number;
	properties?: Record<string, unknown>;
	/** The level the quad was written at, in a store that classifies each quad it holds rather than each record. */
	accessLevel?: AccessLevel;
}

/** A quad as a page carries it or a site sends it. */
export const QuadSchema = z
	.object({
		subject: z.string(),
		predicate: z.string(),
		object: z.unknown(),
		namedGraph: z.string(),
		objectType: z.string().optional(),
		timestamp: z.number(),
		properties: z.record(z.string(), z.unknown()).optional(),
		accessLevel: AccessLevelSchema.optional(),
	})
	.strict() satisfies z.ZodType<TQuad>;

export interface TQuadPattern {
	subject?: string;
	predicate?: string;
	object?: unknown;
	namedGraph?: string;
}

/** Whether a pattern matches a quad: each field the pattern names equals the quad's, and an object is compared as a value,
 *  so an array or an object a quad holds compares equal wherever it is read. Every store of quads matches a pattern
 *  through this one rule. */
export function matchesQuadPattern(q: TQuad, p: TQuadPattern): boolean {
	const objectEquals = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);
	return (
		(p.subject === undefined || q.subject === p.subject) &&
		(p.predicate === undefined || q.predicate === p.predicate) &&
		(p.namedGraph === undefined || q.namedGraph === p.namedGraph) &&
		(p.object === undefined || objectEquals(q.object, p.object))
	);
}

/**
 * The options of the clustered read. `scope` states whether federated peers join the merge. `"federated"`, or an unstated
 * scope, reads an instance's own view: its own layer, its backing stores and every federated peer. `"own"` reads what it
 * serves to a peer: its own layer and its backing stores. A federated read states `"own"`, since a peer is authoritative
 * for what it hosts, and a view of views would recurse on a federation cycle.
 */
export type TClusteredQuadsOpts = { perTypeLimit: number; types?: string[]; accessLevel: AccessLevel; scope?: "own" | "federated" };

export interface TCluster {
	/** Persisted label this cluster represents. */
	type: string;
	/** Total individuals of this type in the store. */
	totalCount: number;
	/** Individuals included in `quads` (≤ perTypeLimit). */
	sampledCount: number;
	/** Individuals not represented in `quads` (totalCount − sampledCount). */
	omittedCount: number;
	/** True where the store's count stopped at its ceiling. The type then holds at least `totalCount` individuals. */
	saturated?: boolean;
	/** Subjects for which quads are present, in sample order. */
	sampledSubjects: string[];
	/** The count of the individuals the sample leaves out under each sampled subject that contains them, by that subject.
	 *  The sample doesn't hold a subject that contains the rest of `omittedCount`. */
	omittedUnder?: Record<string, number>;
	/**
	 * Display label for every sampled subject: the single source of a node's title.
	 * Required and total: each producer fills one entry per `sampledSubjects` via the
	 * shared `composeDisplayLabel` (name/content rel → shortest linked-body preview →
	 * id), so views render straight from it and never compute their own label.
	 */
	displayLabels: Record<string, string>;
	/**
	 * Site principal (did:site DID) per sampled subject, for subjects served by a FEDERATED peer. A read-time
	 * store fact, never persisted on the data: which site's store served the subject. Absent for a subject
	 * served by the responding site itself: the response-level `TClusteredQuads.site` is its principal.
	 */
	sites?: Record<string, string>;
}

export interface TClusteredQuads {
	quads: TQuad[];
	clusters: TCluster[];
	/** Site principal of the responding instance: the serving site of every sampled subject not overridden in `TCluster.sites`. */
	site?: string;
}
