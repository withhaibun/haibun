/**
 * Tutorial graph stepper — a minimal, self-contained example of how a stepper exposes a graph to the shu SPA.
 *
 * The domain is dessert recipes, because the relationships are intuitive:
 *
 *   Recipe ──variationOf──▶ Recipe     a recipe can be a variation of another (forming a tree of variations)
 *   Ingredient ──usedIn──▶ Recipe      an ingredient is used in a recipe
 *
 * Every node is projected as a JSON-LD node: `@id` (its IRI) and `@type` (its label) plus its domain
 * fields. Edges are typed links (`as:inReplyTo`, `schema:isPartOf`) between those `@id`s. The SPA navigates
 * purely by following `@id`/`@type` and the edges — nothing is hard-coded about recipes. That is the lesson:
 * the data is the API (HATEOAS), and JSON-LD makes its shape self-describing.
 *
 * An in-memory store stands in for a graph database so the example runs with no external service.
 */
import { AStepper, type TStepperSteps, type IStepperCycles, type IStepperConcerns } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import { LinkRelations, DOMAIN_PERSISTED_TYPE, jsonLdIndividualOf } from "@haibun/core/lib/resources.js";
import { objectCoercer } from "@haibun/core/lib/domains.js";
import { z } from "zod";

const DOMAIN_QUERY = "tutorial-graph-query";
const DOMAIN_VERTEX_DATA = "tutorial-vertex-data";
const DOMAIN_RECIPE = "tutorial-recipe";
const DOMAIN_INGREDIENT = "tutorial-ingredient";

export const RecipeLabels = { Recipe: "Recipe", Ingredient: "Ingredient" } as const;

const RecipeSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().default(""),
	published: z.string().default(""),
	generatedAtTime: z.string().default(""),
});
const IngredientSchema = z.object({ id: z.string(), name: z.string(), published: z.string().default(""), generatedAtTime: z.string().default("") });

// Query and entity products are strict JSON-LD nodes — a Recipe or an Ingredient, never anything else.
const VertexSchema = z.union([jsonLdIndividualOf(RecipeLabels.Recipe, RecipeSchema), jsonLdIndividualOf(RecipeLabels.Ingredient, IngredientSchema)]);

const EdgeResultSchema = z.object({ type: z.string(), target: VertexSchema });
const CreatedEdgeSchema = z.object({ id: z.string(), fromLabel: z.string(), fromId: z.string(), rel: z.string(), toLabel: z.string(), toId: z.string() });

const QueryResultSchema = z.object({ vertices: z.array(VertexSchema), total: z.number(), cypher: z.string() });
const VertexWithEdgesSchema = z.object({ vertex: VertexSchema, edges: z.array(EdgeResultSchema), incomingCount: z.number() });
const IncomingEdgesResultSchema = z.object({ edges: z.array(EdgeResultSchema), total: z.number() });
const JsonLdDocSchema = z.object({ "@context": z.record(z.string(), z.unknown()), "@graph": z.array(VertexSchema) });

const VertexDataSchema = z.record(z.string(), z.unknown());
const GraphQuerySchema = z.object({
	label: z.string().optional(),
	textQuery: z.string().optional(),
	sortBy: z.string().optional(),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	limit: z.number().int().positive().default(100),
	offset: z.number().int().nonnegative().default(0),
});

interface StoredVertex {
	id: string;
	vertexLabel: string;
	properties: Record<string, unknown>;
}
interface StoredEdge {
	id: string;
	fromLabel: string;
	fromId: string;
	rel: string;
	toLabel: string;
	toId: string;
}

/** In-memory stand-in for a graph database: nodes and directed, typed edges between them. */
class TutorialGraphStore {
	private vertices: StoredVertex[] = [];
	private edges: StoredEdge[] = [];
	private edgeSeq = 0;

	/** Project a stored node as a JSON-LD node: `@id` (IRI) + `@type` (label) + its fields. */
	toJsonLd(v: StoredVertex): Record<string, unknown> {
		return { "@id": `${v.vertexLabel}/${v.id}`, "@type": v.vertexLabel, ...v.properties };
	}

	createVertex(label: string, id: string, properties: Record<string, unknown>): StoredVertex {
		const existing = this.vertices.find((v) => v.vertexLabel === label && v.id === id);
		if (existing) {
			existing.properties = { ...existing.properties, ...properties };
			return existing;
		}
		const vertex: StoredVertex = { id, vertexLabel: label, properties: { id, ...properties } };
		this.vertices.push(vertex);
		return vertex;
	}

	createEdge(fromLabel: string, fromId: string, rel: string, toLabel: string, toId: string): StoredEdge {
		const edge: StoredEdge = { id: `edge-${++this.edgeSeq}`, fromLabel, fromId, rel, toLabel, toId };
		this.edges.push(edge);
		return edge;
	}

	getVertex(label: string, id: string): StoredVertex | undefined {
		return this.vertices.find((v) => v.vertexLabel === label && v.id === id);
	}

	query(label?: string, textFilter?: string): StoredVertex[] {
		let results = this.vertices;
		if (label) results = results.filter((v) => v.vertexLabel === label);
		if (textFilter) {
			const lower = textFilter.toLowerCase();
			results = results.filter((v) => Object.values(v.properties).some((p) => String(p).toLowerCase().includes(lower)));
		}
		return results;
	}

	/** The JSON-LD node an edge points at, resolved from the target's label + id. */
	target(label: string, id: string): Record<string, unknown> {
		const v = this.getVertex(label, id);
		if (!v) throw new Error(`edge points to missing vertex ${label}/${id}`);
		return this.toJsonLd(v);
	}

	outgoing(label: string, id: string): StoredEdge[] {
		return this.edges.filter((e) => e.fromLabel === label && e.fromId === id);
	}
	incoming(label: string, id: string): StoredEdge[] {
		return this.edges.filter((e) => e.toLabel === label && e.toId === id);
	}

	/** The whole graph as a JSON-LD document: a shared `@context` mapping terms to IRIs, and a `@graph` of nodes. */
	exportAsJsonLd(): { "@context": Record<string, unknown>; "@graph": Record<string, unknown>[] } {
		const context = {
			"@vocab": "http://schema.org/",
			name: LinkRelations.NAME.uri,
			description: LinkRelations.CONTENT.uri,
			published: LinkRelations.PUBLISHED.uri,
			generatedAtTime: LinkRelations.GENERATED_AT_TIME.uri,
		};
		return { "@context": context, "@graph": this.vertices.map((v) => this.toJsonLd(v)) };
	}
}

export default class TutorialGraphStepper extends AStepper {
	private store = new TutorialGraphStore();

	cycles: IStepperCycles = {
		getConcerns: (): IStepperConcerns => ({
			domains: [
				{
					selectors: [DOMAIN_QUERY],
					schema: GraphQuerySchema,
					coerce: objectCoercer(GraphQuerySchema),
					description: "A graph query: optional type, text filter, sort, and paging",
				},
				{ selectors: [DOMAIN_VERTEX_DATA], schema: VertexDataSchema, coerce: objectCoercer(VertexDataSchema), description: "Vertex properties as JSON" },
				{
					selectors: [DOMAIN_RECIPE],
					schema: RecipeSchema,
					description: "A recipe — its name, method, and the recipe it is a variation of.",
					topology: {
						persistedAs: RecipeLabels.Recipe,
						id: "id",
						properties: {
							id: LinkRelations.IDENTIFIER.rel,
							name: LinkRelations.NAME.rel,
							description: LinkRelations.CONTENT.rel,
							published: LinkRelations.PUBLISHED.rel,
							generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
						},
						edges: { variationOf: { rel: LinkRelations.IN_REPLY_TO.rel, range: RecipeLabels.Recipe } },
					},
				},
				{
					selectors: [DOMAIN_INGREDIENT],
					schema: IngredientSchema,
					description: "An ingredient and the recipes it is used in.",
					topology: {
						persistedAs: RecipeLabels.Ingredient,
						id: "id",
						properties: {
							id: LinkRelations.IDENTIFIER.rel,
							name: LinkRelations.NAME.rel,
							published: LinkRelations.PUBLISHED.rel,
							generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
						},
						edges: { usedIn: { rel: LinkRelations.PART_OF.rel, range: RecipeLabels.Recipe } },
					},
				},
			],
		}),
	};

	steps = {
		graphQuery: {
			gwta: `graph query {query: ${DOMAIN_QUERY}}`,
			productsSchema: QueryResultSchema,
			action: ({ query }: { query: z.infer<typeof GraphQuerySchema> }) => {
				try {
					const { label, textQuery, sortBy, sortOrder, limit, offset } = query;
					let results = this.store.query(label, textQuery);
					if (sortBy) {
						const dir = sortOrder === "asc" ? 1 : -1;
						results = [...results].sort((a, b) => dir * String(a.properties[sortBy] ?? "").localeCompare(String(b.properties[sortBy] ?? "")));
					}
					return actionOKWithProducts({
						vertices: results.slice(offset, offset + limit).map((v) => this.store.toJsonLd(v)),
						total: results.length,
						cypher: `MATCH (n:${label || "*"}) RETURN n SKIP ${offset} LIMIT ${limit}`,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getIndividualWithEdges: {
			gwta: `get vertex {label: ${DOMAIN_PERSISTED_TYPE}} with id {id: string} and its outgoing edges`,
			productsSchema: VertexWithEdgesSchema,
			action: ({ label, id }: { label: string; id: string }) => {
				try {
					const vertex = this.store.getVertex(label, id);
					if (!vertex) return actionNotOK(`Vertex ${label}/${id} not found`);
					return actionOKWithProducts({
						vertex: this.store.toJsonLd(vertex),
						edges: this.store.outgoing(label, id).map((e) => ({ type: e.rel, target: this.store.target(e.toLabel, e.toId) })),
						incomingCount: this.store.incoming(label, id).length,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getIncomingEdges: {
			gwta: `get incoming edges for {label: ${DOMAIN_PERSISTED_TYPE}} vertex {id: string} with limit {limit} and offset {offset}`,
			productsSchema: IncomingEdgesResultSchema,
			action: ({ label, id, limit = 100, offset = 0 }: { label: string; id: string; limit?: number; offset?: number }) => {
				try {
					const all = this.store.incoming(label, id);
					return actionOKWithProducts({
						edges: all.slice(offset, offset + limit).map((e) => ({ type: e.rel, target: this.store.target(e.fromLabel, e.fromId) })),
						total: all.length,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		createVertex: {
			gwta: `create vertex {label: ${DOMAIN_PERSISTED_TYPE}} with id {id: string} and properties {data: ${DOMAIN_VERTEX_DATA}}`,
			productsSchema: VertexSchema,
			action: ({ label, id, data }: { label: string; id: string; data: Record<string, unknown> }) => {
				try {
					return actionOKWithProducts(this.store.toJsonLd(this.store.createVertex(label, id, data)));
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		createEdge: {
			gwta: "create edge from {fromLabel: string} {fromId: string} with rel {rel: string} to {toLabel: string} {toId: string}",
			productsSchema: z.object({ edge: CreatedEdgeSchema }),
			action: ({ fromLabel, fromId, rel, toLabel, toId }: { fromLabel: string; fromId: string; rel: string; toLabel: string; toId: string }) => {
				try {
					return actionOKWithProducts({ edge: this.store.createEdge(fromLabel, fromId, rel, toLabel, toId) });
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		exportGraphAsJsonLd: {
			gwta: "export graph as JSON-LD",
			productsSchema: JsonLdDocSchema,
			action: () => {
				try {
					return actionOKWithProducts(this.store.exportAsJsonLd());
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},
	} satisfies TStepperSteps;
}
