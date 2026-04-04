import { AStepper, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import {
	actionNotOK,
	actionOKWithProducts,
} from "@haibun/core/lib/util/index.js";
import {
	LinkRelations,
	DOMAIN_VERTEX_LABEL,
	type IStepperCycles,
	type IStepperConcerns,
} from "@haibun/core/lib/defs.js";
import { objectCoercer } from "@haibun/core/lib/domain-types.js";
import { z } from "zod";

const DOMAIN_TUTORIAL_QUERY = "tutorial-graph-query";
const DOMAIN_VERTEX_DATA = "tutorial-vertex-data";

export const TutorialLabels = {
	Researcher: "Researcher",
	Paper: "Paper",
} as const;
export const TutorialEdges = {
	authored: "authored",
	references: "references",
	author: "author",
} as const;

const VertexDataSchema = z.record(z.string(), z.unknown());

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

const ResolvedEdgeSchema = z.object({
	type: z.string(),
	target: z.record(z.string(), z.unknown()),
});
const IncomingEdgesResultSchema = z.object({
	edges: z.array(ResolvedEdgeSchema),
	total: z.number(),
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

	createVertex(
		label: string,
		id: string,
		properties: Record<string, unknown>,
	): InMemoryVertex {
		const existing = this.vertices.find(
			(v) => v.vertexLabel === label && v.id === id,
		);
		if (existing) {
			existing.properties = { ...existing.properties, ...properties };
			return existing;
		}
		const vertex: InMemoryVertex = {
			id,
			vertexLabel: label,
			properties: { id, ...properties },
		};
		this.vertices.push(vertex);
		return vertex;
	}

	query(label?: string, textFilter?: string): InMemoryVertex[] {
		let results = this.vertices;
		if (label) results = results.filter((v) => v.vertexLabel === label);
		if (textFilter) {
			const lower = textFilter.toLowerCase();
			results = results.filter((v) =>
				Object.values(v.properties).some((p) =>
					String(p).toLowerCase().includes(lower),
				),
			);
		}
		return results;
	}

	getVertex(label: string, id: string): InMemoryVertex | undefined {
		return this.vertices.find((v) => v.vertexLabel === label && v.id === id);
	}

	resolveEdgeTarget(
		targetLabel: string,
		targetId: string,
	): Record<string, unknown> {
		const v = this.getVertex(targetLabel, targetId);
		return v
			? { ...v.properties, _label: targetLabel }
			: { id: targetId, _label: targetLabel };
	}

	getVertexWithEdges(label: string, id: string) {
		const vertex = this.getVertex(label, id);
		if (!vertex) return null;
		const outgoing = this.edges.filter(
			(e) => e.fromId === id && e.fromLabel === label,
		);
		const incomingCount = this.edges.filter(
			(e) => e.toId === id && e.toLabel === label,
		).length;
		return { vertex, edges: outgoing, incomingCount };
	}

	getIncomingEdges(label: string, id: string, limit = 100, offset = 0) {
		const incoming = this.edges.filter(
			(e) => e.toId === id && e.toLabel === label,
		);
		return {
			edges: incoming.slice(offset, offset + limit),
			total: incoming.length,
		};
	}

	createEdge(
		fromLabel: string,
		fromId: string,
		rel: string,
		toLabel: string,
		toId: string,
	) {
		const edge: InMemoryEdge = {
			id: `edge-${++this.idCounter}`,
			fromLabel,
			fromId,
			rel,
			toLabel,
			toId,
		};
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
		const graph = this.vertices.map((v) => ({
			"@type": v.vertexLabel,
			...v.properties,
		}));
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
					selectors: [DOMAIN_VERTEX_DATA],
					schema: VertexDataSchema,
					coerce: objectCoercer(VertexDataSchema),
					description: "Vertex properties as JSON",
				},
				{
					selectors: ["tutorial-researcher"],
					schema: VertexSchema,
					meta: {
						vertexLabel: TutorialLabels.Researcher,
						id: "id",
						properties: {
							id: LinkRelations.IDENTIFIER.rel,
							name: LinkRelations.NAME.rel,
							context: LinkRelations.CONTEXT.rel,
							published: LinkRelations.PUBLISHED.rel,
						},
						edges: {
							[TutorialEdges.authored]: {
								rel: LinkRelations.ATTRIBUTED_TO.rel,
								target: TutorialLabels.Paper,
							},
						},
					},
				},
				{
					selectors: ["tutorial-paper"],
					schema: VertexSchema,
					meta: {
						vertexLabel: TutorialLabels.Paper,
						id: "id",
						properties: {
							id: LinkRelations.IDENTIFIER.rel,
							name: LinkRelations.NAME.rel,
							content: LinkRelations.CONTENT.rel,
							published: LinkRelations.PUBLISHED.rel,
							updated: LinkRelations.UPDATED.rel,
						},
						edges: {
							[TutorialEdges.references]: {
								rel: LinkRelations.IN_REPLY_TO.rel,
								target: TutorialLabels.Paper,
							},
							[TutorialEdges.author]: {
								rel: LinkRelations.ATTRIBUTED_TO.rel,
								target: TutorialLabels.Researcher,
							},
						},
					},
				},
			],
		}),
	};

	steps = {
		graphQuery: {
			gwta: `graph query {query: ${DOMAIN_TUTORIAL_QUERY}}`,
			outputSchema: QueryResultSchema,
			action: ({ query }: { query: z.infer<typeof GraphQuerySchema> }) => {
				try {
					const { label, textQuery, limit, offset } = query;
					const results = this.store.query(label, textQuery);
					const paginated = results.slice(offset, offset + limit);
					return actionOKWithProducts({
						vertices: paginated.map((v) => ({
							...v.properties,
							_label: v.vertexLabel,
						})),
						total: results.length,
						cypher: `MATCH (n:${label || "*"}) RETURN n LIMIT ${limit}`,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getVertexWithEdges: {
			gwta: `get vertex {label: ${DOMAIN_VERTEX_LABEL}} with id {id: string} and its outgoing edges`,
			outputSchema: VertexWithEdgesSchema,
			action: ({ label, id }: { label: string; id: string }) => {
				try {
					const result = this.store.getVertexWithEdges(label, id);
					if (!result) return actionNotOK(`Vertex ${label}/${id} not found`);
					const edges = result.edges.map((e) => {
						return {
							type: e.rel,
							target: this.store.resolveEdgeTarget(e.toLabel, e.toId),
						};
					});
					return actionOKWithProducts({
						vertex: {
							...result.vertex.properties,
							_label: result.vertex.vertexLabel,
						},
						edges,
						incomingCount: result.incomingCount,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		getIncomingEdges: {
			gwta: `get incoming edges for {label: ${DOMAIN_VERTEX_LABEL}} vertex {id: string} with limit {limit} and offset {offset}`,
			outputSchema: IncomingEdgesResultSchema,
			action: ({
				label,
				id,
				limit = 100,
				offset = 0,
			}: {
				label: string;
				id: string;
				limit?: number;
				offset?: number;
			}) => {
				try {
					const raw = this.store.getIncomingEdges(label, id, limit, offset);
					const edges = raw.edges.map((e) => {
						return {
							type: e.rel,
							target: this.store.resolveEdgeTarget(e.fromLabel, e.fromId),
						};
					});
					return actionOKWithProducts({ edges, total: raw.total });
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		createVertex: {
			gwta: `create vertex {label: ${DOMAIN_VERTEX_LABEL}} with id {id: string} and properties {data: ${DOMAIN_VERTEX_DATA}}`,
			outputSchema: VertexSchema,
			action: ({
				label,
				id,
				data,
			}: {
				label: string;
				id: string;
				data: Record<string, unknown>;
			}) => {
				try {
					const vertex = this.store.createVertex(label, id, data);
					return actionOKWithProducts({
						...vertex.properties,
						_label: vertex.vertexLabel,
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		createEdge: {
			gwta: "create edge from {fromLabel: string} {fromId: string} with rel {rel: string} to {toLabel: string} {toId: string}",
			outputSchema: z.object({ edge: EdgeSchema }),
			action: ({
				fromLabel,
				fromId,
				rel,
				toLabel,
				toId,
			}: {
				fromLabel: string;
				fromId: string;
				rel: string;
				toLabel: string;
				toId: string;
			}) => {
				try {
					return actionOKWithProducts({
						edge: this.store.createEdge(fromLabel, fromId, rel, toLabel, toId),
					});
				} catch (err) {
					return actionNotOK(String(err));
				}
			},
		},

		exportGraphAsJsonLd: {
			gwta: "export graph as JSON-LD",
			outputSchema: z.object({
				"@context": z.record(z.string(), z.unknown()),
				"@graph": z.array(z.record(z.string(), z.unknown())),
			}),
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
