import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { actionNotOK, actionOKWithProducts } from "@haibun/core/lib/util/index.js";
import type { IStepperCycles, IStepperConcerns } from "@haibun/core/lib/defs.js";
import { objectCoercer } from "@haibun/core/lib/domain-types.js";
import { z } from "zod";

const DOMAIN_TUTORIAL_QUERY = "tutorial-graph-query";

export const TutorialLabels = { Researcher: "Researcher", Paper: "Paper" } as const;
export const TutorialEdges = { authored: "authored", references: "references", author: "author" } as const;

const VertexSchema = z.object({
	id: z.string(),
	label: z.string(),
	vertexLabel: z.string(),
	properties: z.record(z.string(), z.unknown()),
});

const EdgeSchema = z.object({
	id: z.string(),
	fromLabel: z.string(),
	fromId: z.string(),
	rel: z.string(),
	toLabel: z.string(),
	toId: z.string(),
});

const QueryResultSchema = z.object({
	vertices: z.array(VertexSchema),
	total: z.number(),
	cypher: z.string().optional(),
});

const VertexWithEdgesSchema = z.object({
	vertex: VertexSchema,
	edges: z.array(EdgeSchema),
	incomingCount: z.number(),
});

const FilterSchema = z.object({
	field: z.string().optional(),
	value: z.string().optional(),
});

const GraphQuerySchema = z.object({
	label: z.string().optional(),
	filters: z.array(FilterSchema).default([]),
	textQuery: z.string().optional(),
	sortBy: z.string().optional(),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	limit: z.number().int().positive().default(100),
	offset: z.number().int().nonnegative().default(0),
});

interface InMemoryVertex {
	id: string;
	vertexLabel: string;
	properties: Record<string, unknown>;
}

interface InMemoryEdge {
	id: string;
	fromLabel: string;
	fromId: string;
	rel: string;
	toLabel: string;
	toId: string;
}

class TutorialGraphStore {
	private vertices: InMemoryVertex[] = [];
	private edges: InMemoryEdge[] = [];
	private idCounter = 0;

	constructor() {
		this.seedData();
	}

	private seedData() {
		const researcherA: InMemoryVertex = {
			id: "researcher-alice",
			vertexLabel: TutorialLabels.Researcher,
			properties: { id: "researcher-alice", name: "Dr. Alice Chen", context: "Knowledge Graph Research at TechCorp", published: new Date("2020-01-15").toISOString() },
		};
		const researcherB: InMemoryVertex = {
			id: "researcher-bob",
			vertexLabel: TutorialLabels.Researcher,
			properties: { id: "researcher-bob", name: "Prof. Bob Wilson", context: "Graph Databases at UniState", published: new Date("2018-06-20").toISOString() },
		};
		const paperA: InMemoryVertex = {
			id: "paper-semantic-web",
			vertexLabel: TutorialLabels.Paper,
			properties: { id: "paper-semantic-web", name: "Building Semantic Graphs with RDF", content: "This paper explores how to model relationships using RDF quads and hypermedia rels.", published: new Date("2024-03-01").toISOString(), updated: new Date("2024-09-15").toISOString() },
		};
		const paperB: InMemoryVertex = {
			id: "paper-hypermedia",
			vertexLabel: TutorialLabels.Paper,
			properties: { id: "paper-hypermedia", name: "HATEOAS: The Heart of Hypermedia APIs", content: "Explains how hypermedia rels enable clients to discover operations at runtime.", published: new Date("2023-11-10").toISOString(), updated: new Date("2024-01-01").toISOString() },
		};
		const paperC: InMemoryVertex = {
			id: "paper-jsonld",
			vertexLabel: TutorialLabels.Paper,
			properties: { id: "paper-jsonld", name: "JSON-LD and Semantic Web Integration", content: "How JSON-LD provides a bridge between JSON APIs and semantic web standards.", published: new Date("2024-02-14").toISOString() },
		};
		this.vertices = [researcherA, researcherB, paperA, paperB, paperC];
		this.edges = [
			{ id: "edge-alice-authored-semantic", fromLabel: TutorialLabels.Researcher, fromId: "researcher-alice", rel: "attributedTo", toLabel: TutorialLabels.Paper, toId: "paper-semantic-web" },
			{ id: "edge-bob-authored-hypermedia", fromLabel: TutorialLabels.Researcher, fromId: "researcher-bob", rel: "attributedTo", toLabel: TutorialLabels.Paper, toId: "paper-hypermedia" },
			{ id: "edge-alice-coauthor-jsonld", fromLabel: TutorialLabels.Researcher, fromId: "researcher-alice", rel: "attributedTo", toLabel: TutorialLabels.Paper, toId: "paper-jsonld" },
			{ id: "edge-semantic-references-hypermedia", fromLabel: TutorialLabels.Paper, fromId: "paper-semantic-web", rel: "inReplyTo", toLabel: TutorialLabels.Paper, toId: "paper-hypermedia" },
			{ id: "edge-hypermedia-references-jsonld", fromLabel: TutorialLabels.Paper, fromId: "paper-hypermedia", rel: "inReplyTo", toLabel: TutorialLabels.Paper, toId: "paper-jsonld" },
		];
	}

	query(label?: string, textFilter?: string): InMemoryVertex[] {
		let results = this.vertices;
		if (label) results = results.filter((v) => v.vertexLabel === label);
		if (textFilter) {
			const lower = textFilter.toLowerCase();
			results = results.filter((v) => Object.values(v.properties).some((p) => String(p).toLowerCase().includes(lower)));
		}
		return results;
	}

	getVertexWithEdges(label: string, id: string) {
		const vertex = this.vertices.find((v) => v.vertexLabel === label && v.id === id);
		if (!vertex) return null;
		const outgoing = this.edges.filter((e) => e.fromId === id && e.fromLabel === label);
		const incomingCount = this.edges.filter((e) => e.toId === id && e.toLabel === label).length;
		return { vertex, edges: outgoing, incomingCount };
	}

	getIncomingEdges(label: string, id: string, limit = 100, offset = 0) {
		const incoming = this.edges.filter((e) => e.toId === id && e.toLabel === label);
		return { edges: incoming.slice(offset, offset + limit), total: incoming.length };
	}

	createEdge(fromLabel: string, fromId: string, rel: string, toLabel: string, toId: string) {
		const edge: InMemoryEdge = { id: `edge-${++this.idCounter}`, fromLabel, fromId, rel, toLabel, toId };
		this.edges.push(edge);
		return edge;
	}

	exportAsJsonLd() {
		const context = {
			"@vocab": "http://schema.org/",
			id: "@id",
			name: "http://schema.org/name",
			context: "http://purl.org/dc/terms/subject",
			published: "http://purl.org/dc/terms/issued",
			updated: "http://purl.org/dc/terms/modified",
			content: "http://schema.org/description",
			attributedTo: "http://purl.org/dc/terms/creator",
			inReplyTo: "http://www.w3.org/2002/07/owl#sameAs",
		};
		const graph = this.vertices.map((v) => ({ "@type": v.vertexLabel, ...v.properties }));
		return { "@context": context, "@graph": graph };
	}
}

export default class TutorialGraphStepper extends AStepper {
	private store = new TutorialGraphStore();

	cycles: IStepperCycles = {
		getConcerns: (): IStepperConcerns => ({
			domains: [
				{
					selectors: [DOMAIN_TUTORIAL_QUERY],
					schema: GraphQuerySchema,
					coerce: objectCoercer(GraphQuerySchema),
					description: "Tutorial graph query",
				},
				{
					selectors: ["tutorial-researcher"],
					schema: VertexSchema,
					meta: {
						vertexLabel: TutorialLabels.Researcher, id: "id",
						properties: { id: "identifier", name: "name", context: "context", published: "published" },
						edges: { [TutorialEdges.authored]: { rel: "attributedTo", target: TutorialLabels.Paper } },
					},
				},
				{
					selectors: ["tutorial-paper"],
					schema: VertexSchema,
					meta: {
						vertexLabel: TutorialLabels.Paper, id: "id",
						properties: { id: "identifier", name: "name", content: "content", published: "published", updated: "updated" },
						edges: { [TutorialEdges.references]: { rel: "inReplyTo", target: TutorialLabels.Paper }, [TutorialEdges.author]: { rel: "attributedTo", target: TutorialLabels.Researcher } },
					},
				},
			],
		}),
	};

	steps: TStepperSteps = {
		graphQuery: {
			gwta: `graph query {query: ${DOMAIN_TUTORIAL_QUERY}}`,
			outputSchema: QueryResultSchema,
			action: ({ query }: { query: z.infer<typeof GraphQuerySchema> }) => {
				try {
					const { label, textQuery, limit, offset } = query;
					const results = this.store.query(label, textQuery);
					const paginated = results.slice(offset, offset + limit);
					return actionOKWithProducts({
						vertices: paginated.map((v) => ({ ...v.properties, _label: v.vertexLabel })),
						total: results.length,
						cypher: `MATCH (n:${label || "*"}) RETURN n LIMIT ${limit}`,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getVertexWithEdges: {
			gwta: "get vertex {label: string} with id {id: string} and its outgoing edges",
			outputSchema: VertexWithEdgesSchema,
			action: ({ label, id }: { label: string; id: string }) => {
				try {
					const result = this.store.getVertexWithEdges(label, id);
					if (!result) return actionNotOK(`Vertex ${label}/${id} not found`);
					const edges = result.edges.map((e) => {
						const target = this.store.getVertexWithEdges(e.toLabel, e.toId);
						return { type: e.rel, target: target ? { ...target.vertex.properties, _label: e.toLabel } : { id: e.toId, _label: e.toLabel } };
					});
					return actionOKWithProducts({ vertex: { ...result.vertex.properties, _label: result.vertex.vertexLabel }, edges, incomingCount: result.incomingCount });
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getIncomingEdges: {
			gwta: "get incoming edges for {label: string} vertex {id: string} with limit {limit} and offset {offset}",
			outputSchema: z.object({ edges: z.array(EdgeSchema), total: z.number() }),
			action: ({ label, id, limit = 100, offset = 0 }: { label: string; id: string; limit?: number; offset?: number }) => {
				try {
					return actionOKWithProducts(this.store.getIncomingEdges(label, id, limit, offset));
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		createEdge: {
			gwta: "create edge from {fromLabel: string} {fromId: string} with rel {rel: string} to {toLabel: string} {toId: string}",
			outputSchema: z.object({ edge: EdgeSchema }),
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
			outputSchema: z.object({ "@context": z.record(z.string(), z.unknown()), "@graph": z.array(z.record(z.string(), z.unknown())) }),
			action: () => {
				try {
					return actionOKWithProducts(this.store.exportAsJsonLd());
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},
	};
}
