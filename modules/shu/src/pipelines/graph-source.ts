/**
 * The graph a page draws: the clustered sample of the store with the schema its terms use, the same sample as the report
 * carries it, the layout a feature reads as tokens, and a federated peer's graph merged into this instance's.
 */
import { MAX_PAGE_ROWS, buildResourceRels, pageLimit, relOf } from "@haibun/core/lib/domains/hypermedia.js";
import { hypermediaDomainMap } from "@haibun/core/lib/domains/domains.js";
import { Access, LinkRelations, storeScopeFor, type AccessLevel, type AccessQueryLevel } from "@haibun/core/lib/domains/resources.js";
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import type { TClusteredQuads, TQuad } from "@haibun/core/lib/quad-types.js";
import { QuadGraphModel } from "@haibun/core/lib/derivations/quad-graph-model.js";
import { QuadStore } from "@haibun/core/lib/quad-store.js";
import { enumerateStandardVocab } from "@haibun/core/lib/records/pipelines/standard-vocabulary.js";
import { activeSitePrincipal, adoptSitePrincipal, hasDefaultSitePrincipal } from "@haibun/core/lib/domains/host-id.js";
import { persistPrincipalIndividual } from "@haibun/core/lib/domains/principal-individual.js";
import { requestSigner } from "@haibun/core/lib/session-authority.js";
import type { TWorld } from "@haibun/core/lib/world.js";
import { withOntologySchema } from "../derivations/ontology-projection.js";
import { buildGraphModelFromQuads } from "../derivations/graph-model.js";
import type { TOpenPeerGraphSource, TPeerCalls } from "../ports.js";
import { RPC_METHOD } from "../domains/elements.js";
import { AUTHORITY_CAPABILITIES } from "@haibun/core/lib/domains/actions.js";
import { stepMethodName } from "@haibun/core/lib/steps/domains/step-method.js";

type TClusters = Awaited<ReturnType<NonNullable<IQuadStore["getClusteredQuads"]>>>["clusters"];

/** The graph a report carries: the quads with their schema, the clusters, each node and each typed reference. */
export type TGraphSource = {
	quads: TQuad[];
	clusters: TClusters;
	nodeMap: Map<string, { graph: string; subject: string }>;
	edges: { source: string; predicate: string; object: string }[];
};

/** The tokens a feature matches a graph's layout by: a node is `graph|subject|label`, an edge `source|predicate|target`. */
export type TGraphLayout = { nodes: string[]; edges: string[]; clusters: { type: string; total: number; sampled: number }[] };

/** The refusal of a store that doesn't sample clusters. */
export const NOT_CLUSTERED = "the store doesn't sample clusters (getClusteredQuads)";

/** Whether the world's store samples clusters. */
export const clusters = (world: TWorld): boolean => world.shared.getStore().getClusteredQuads !== undefined;

/** The store's clustered read, or a refusal of a store that doesn't sample clusters. */
function clustered(world: TWorld): NonNullable<IQuadStore["getClusteredQuads"]> {
	const store = world.shared.getStore();
	if (!store.getClusteredQuads) throw new Error(NOT_CLUSTERED);
	return store.getClusteredQuads.bind(store);
}

/** The schema a response carries beside its quads: the Class, Property and rdf:type statements its terms use. */
async function withSchema(world: TWorld, sample: { quads: TQuad[]; clusters: TClusters }): Promise<{ quads: TQuad[]; clusters: TClusters }> {
	const standardVocab = await enumerateStandardVocab(world.domains, (message) => world.eventLogger.warn(message));
	return withOntologySchema(sample, sample.quads, world.domains, standardVocab);
}

/**
 * The graph a report carries: the whole of this site's own graph, instrumentation included, as the live clustered read
 * returns it, with the nodes and references the page builds from it. The read's scope is this site's own graph, so a
 * report written at shutdown doesn't depend on a federated peer being reachable.
 */
export async function graphSource(world: TWorld): Promise<TGraphSource> {
	const raw = await clustered(world)({ perTypeLimit: MAX_PAGE_ROWS, accessLevel: Access.private, scope: "own" });
	const { quads, clusters } = await withSchema(world, { quads: raw.quads as TQuad[], clusters: raw.clusters });
	const model = buildGraphModelFromQuads(quads);
	const nodeMap = new Map(model.nodes.map((n) => [n.id, { graph: n.type, subject: n.id }]));
	const edges = model.edges.map((e) => ({ source: e.from, predicate: e.predicate, object: e.to }));
	return { quads, clusters, nodeMap, edges };
}

/** The layout of the report's graph as tokens. A node without a display label is labelled by its subject. */
export async function graphLayout(world: TWorld): Promise<TGraphLayout> {
	const { nodeMap, edges, clusters } = await graphSource(world);
	const labels = new Map(clusters.map((c) => [c.type, c.displayLabels]));
	const labelOf = (graph: string, subject: string): string => {
		const label = labels.get(graph)?.[subject];
		return label === undefined ? subject : label;
	};
	return {
		nodes: [...nodeMap.values()].map((n) => `${n.graph}|${n.subject}|${labelOf(n.graph, n.subject)}`),
		edges: edges.map((e) => `${e.source}|${e.predicate}|${e.object}`),
		clusters: clusters.map((c) => ({ type: c.type, total: c.totalCount, sampled: c.sampledCount })),
	};
}

/** What a page requests of the clustered sample: records per type, the types, the query level and the read's scope. */
export type TClusteredRequest = { perTypeLimit: number; types?: string[]; accessLevel: AccessQueryLevel; scope?: "own" | "federated" };

/** The resource relations of a world's domains, built once for each count of them, so a domain declared at runtime builds
 *  them again. Building them walks every domain. */
const relsHeld = new WeakMap<TWorld["domains"], { rels: ReturnType<typeof buildResourceRels>; size: number }>();
function resourceRels(world: TWorld): ReturnType<typeof buildResourceRels> {
	const size = Object.keys(world.domains).length;
	const held = relsHeld.get(world.domains);
	if (held?.size === size) return held.rels;
	const rels = buildResourceRels(world.domains);
	relsHeld.set(world.domains, { rels, size });
	return rels;
}

/**
 * The clustered sample a graph view draws, bounded by the records requested of each type. The store's sample merges into
 * one model that admits at most that many of each type, and the response carries the schema its terms use and the site
 * that served it.
 */
export async function clusteredQuads(world: TWorld, request: TClusteredRequest): Promise<TClusteredQuads> {
	const perTypeLimit = pageLimit("getClusteredQuads", request.perTypeLimit);
	const result = await clustered(world)({ perTypeLimit, types: request.types, accessLevel: storeScopeFor(request.accessLevel), scope: request.scope });
	const rels = resourceRels(world);
	const model = new QuadGraphModel(
		perTypeLimit,
		(type) => rels.fields(type),
		(type) => rels.titledBy(type),
	);
	model.seed({ quads: result.quads as TQuad[], clusters: [...result.clusters] });
	const quads = model.snapshot.quads.map(({ subject, predicate, object, objectType, namedGraph, timestamp, properties }) => ({
		subject,
		predicate,
		object,
		objectType,
		namedGraph,
		timestamp,
		properties,
	}));
	return { ...(await withSchema(world, { quads, clusters: model.snapshot.clusters })), site: activeSitePrincipal(world) };
}

/** Whether this instance's merged sample, read at `level`, holds `subject`, and the site it names as serving it. A subject
 *  without a site is served by this instance. */
export async function servingSite(world: TWorld, type: string, subject: string, level: AccessLevel): Promise<{ held: false } | { held: true; site: string | undefined }> {
	const { clusters } = await clustered(world)({ perTypeLimit: MAX_PAGE_ROWS, accessLevel: level });
	const cluster = clusters.find((c) => c.type === type);
	if (!cluster?.sampledSubjects.includes(subject)) return { held: false };
	return { held: true, site: cluster.sites?.[subject] };
}

/** The steps a peer instance serves federation through: its clustered read, and its naming of a connecting site. */
export const PEER_CALLS: TPeerCalls = {
	clustered: RPC_METHOD.CLUSTERED_QUADS,
	nameSite: { method: stepMethodName("AuthorityStepper", "nameConnectingSite"), action: AUTHORITY_CAPABILITIES.name },
};

/**
 * Merges a peer's clustered reads into this instance's, each of the peer's subjects stamped with its site principal. Site
 * principals are unique in a federation: where this instance still carries the default principal and it collides with
 * the peer's, the peer assigns this instance one. An operator-set principal that collides is refused.
 */
export async function federate(world: TWorld, open: TOpenPeerGraphSource, url: string): Promise<string> {
	const source = open(url, requestSigner(world.runtime), PEER_CALLS);
	const peer = await source.connect();
	if (peer === activeSitePrincipal(world)) {
		if (!hasDefaultSitePrincipal(world)) throw new Error(`federate: site principals collide (${peer}) and this site is operator-named. Set HAIBUN_SITE_KEY uniquely`);
		const assigned = await source.requestName();
		adoptSitePrincipal(world, assigned);
		await persistPrincipalIndividual(world, { id: assigned, controller: assigned, generatedAtTime: new Date().toISOString() });
	}
	const store = world.shared.getStore();
	if (!(store instanceof QuadStore)) throw new Error("federate: the world's store doesn't federate");
	store.federate(source);
	return peer;
}

/** The values a filter offers for each field of `label` that its topology relates by context, read at once. Undefined
 *  where actuality doesn't declare the type's topology. */
export async function selectValues(world: TWorld, label: string): Promise<Record<string, string[]> | undefined> {
	const properties = hypermediaDomainMap(world.domains).get(label)?.topology?.properties;
	if (properties === undefined) return undefined;
	const store = world.shared.getStore();
	const filtered = Object.entries(properties).filter(([, definition]) => relOf(definition) === LinkRelations.CONTEXT.rel);
	return Object.fromEntries(await Promise.all(filtered.map(async ([property]) => [property, (await store.distinctPropertyValues(label, property)).values] as const)));
}
