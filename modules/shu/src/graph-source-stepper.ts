/**
 * GraphSourceStepper declares the steps that answer a page's reads of the graph. A page reads the site's graph the same
 * way whatever answers the read: a query, a count over a span, one individual with its edges, the clustered sample a
 * graph view draws, and the reads a federated peer answers.
 *
 * Each answers from the store this instance holds. The reads a consumer may answer for itself declare `fallback`, so a
 * consumer with an engine of its own answers those instead, and the page asks no differently.
 *
 * The monitor records one run. This stepper answers reads of the graph, which every view draws on.
 */
import { z } from "zod";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { Access, AccessQueryLevelSchema, DOMAIN_PERSISTED_TYPE, LinkRelations, storeScopeFor, type TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionNotOK, actionOKWithProducts, errorDetail } from "@haibun/core/lib/util/index.js";
import {
	DOMAIN_GRAPH_QUERY,
	GraphQueryResultSchema,
	type TGraphQuery,
	DOMAIN_DENSITY_QUERY,
	DensityResultSchema,
	type TDensityQuery,
	IndividualWithEdgesSchema,
	type TQuad,
} from "@haibun/core/lib/quad-types.js";
import { QuadStore, queryQuadStore, individualWithEdges } from "@haibun/core/lib/quad-store.js";
import { DOMAIN_RECORD_ID, hypermediaDomainMap, DOMAIN_LINK, DOMAIN_PRINCIPAL_REF, type TIndividualRef } from "@haibun/core/lib/domains.js";
import { buildResourceRels, relOf } from "@haibun/core/lib/hypermedia.js";
import { QuadGraphModel } from "@haibun/core/lib/quad-graph-model.js";
import { activeSitePrincipal, adoptSitePrincipal, hasDefaultSitePrincipal } from "@haibun/core/lib/host-id.js";
import { persistPrincipalIndividual } from "@haibun/core/lib/principal-individual.js";
import { requestSigner } from "@haibun/core/lib/session-authority.js";
import { RemoteGraphSource } from "./remote-graph-source.js";
import { withOntologySchema } from "./graph/ontology-projection.js";
import { enumerateStandardVocab } from "./graph/standard-vocabulary.js";

/** The values a filter offers for each field of a type that names one. */
const ShuSelectValuesSchema = z.object({ values: z.record(z.string(), z.array(z.string())) });

/** The clustered sample a graph view draws: the quads, and per type what was sampled and what was left out. */
const ClusteredQuadsSchema = z.object({
	quads: z.array(z.unknown()),
	clusters: z.array(
		z.object({
			type: z.string(),
			totalCount: z.number(),
			sampledCount: z.number(),
			omittedCount: z.number(),
			sampledSubjects: z.array(z.string()),
			displayLabels: z.record(z.string(), z.string()).optional(),
			// Site principal per sampled subject SERVED BY A FEDERATED PEER; a subject without an entry was served by `site` below.
			sites: z.record(z.string(), z.string()).optional(),
		}),
	),
	// The responding instance's site principal: the serving site of every subject a cluster does not name one for.
	site: z.string().optional(),
});

/** What the graph a page reads answers with: core's one shape for each, so a site answering for its own store and a page
 *  reading what it holds answer alike. */
const DOMAIN_INDIVIDUAL_WITH_EDGES = "individual-with-edges";
const DOMAIN_SELECT_VALUES = "select-values";
const DOMAIN_CLUSTERED_QUADS = "clustered-quads";
const DOMAIN_SUBJECT_SERVED = "subject-served";
const DOMAIN_SITE_FEDERATED = "site-federated";
const DOMAIN_DENSITY = "density";
const DOMAIN_GRAPH_ROWS = "graph-rows";
/** A subject the merged graph holds, and the site that serves it. */
const SubjectServedSchema = z.object({ subject: z.string(), site: z.string() });
/** The site a peer's reads were federated from. */
const SiteFederatedSchema = z.object({ site: z.string() });
const GRAPH_SOURCE_DOMAINS: TDomainDefinition[] = [
	{ selectors: [DOMAIN_INDIVIDUAL_WITH_EDGES], schema: IndividualWithEdgesSchema, description: "A record, the edges either way, and how many edges point at it" },
	{ selectors: [DOMAIN_SELECT_VALUES], schema: ShuSelectValuesSchema, description: "The values a field of a type holds, which a filter selects from" },
	{ selectors: [DOMAIN_CLUSTERED_QUADS], schema: ClusteredQuadsSchema, description: "The clustered sample a graph view draws" },
	{ selectors: [DOMAIN_SUBJECT_SERVED], schema: SubjectServedSchema, description: "A subject the merged graph holds, and the site that serves it" },
	{ selectors: [DOMAIN_SITE_FEDERATED], schema: SiteFederatedSchema, description: "The site a peer's reads were federated from" },
	{ selectors: [DOMAIN_DENSITY], schema: DensityResultSchema, description: "How many records fall in each division of a span" },
	{ selectors: [DOMAIN_GRAPH_ROWS], schema: GraphQueryResultSchema, description: "The rows a graph query matched, and how many there are" },
];

export default class GraphSourceStepper extends AStepper implements IHasCycles {
	description = "The graph a page reads: a query, a count over a span, the clustered sample a graph view draws, and the reads a federated peer answers.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: GRAPH_SOURCE_DOMAINS }) };

	/** buildResourceRels walks every domain; memoized by domain count so per-read calls reuse it while a runtime-declared
	 *  domain still invalidates. */
	private relsCache?: { rels: ReturnType<typeof buildResourceRels>; size: number };
	private resourceRels(): ReturnType<typeof buildResourceRels> {
		const domains = this.getWorld().domains;
		const size = Object.keys(domains).length;
		if (!this.relsCache || this.relsCache.size !== size) this.relsCache = { rels: buildResourceRels(domains), size };
		return this.relsCache.rels;
	}

	steps = {
		getIndividualWithEdges: {
			read: true,
			gwta: `get individual {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} with edges`,
			recordIds: { id: "label" },
			fallback: true,
			productsDomain: DOMAIN_INDIVIDUAL_WITH_EDGES,
			// A page reads an individual with its edges the same way whatever answers the read. This answers from the store
			// this instance holds, which is what a site with no graph engine of its own has; a deployment that gates a
			// read by what a reader may see declares its own step, and the page reads through that one instead.
			action: async ({ label, id }: { label: string; id: string }) => {
				const held = await individualWithEdges(this.getWorld().shared.getStore(), label, id);
				return held === undefined ? actionNotOK(`nothing of ${label} ${id} is held here`) : actionOKWithProducts(held);
			},
		},
		getSelectValues: {
			read: true,
			gwta: `get select values for {label: ${DOMAIN_PERSISTED_TYPE}}`,
			productsDomain: DOMAIN_SELECT_VALUES,
			action: async ({ label }: { label: string }) => {
				const store = this.getWorld().shared.getStore();
				const domain = hypermediaDomainMap(this.getWorld().domains).get(label);
				if (!domain?.topology?.properties) return actionNotOK(`No filter topology registered for ${label}`);
				// Every field read at once: a type with several filtered fields is one round of reads rather than one per field.
				const filtered = Object.entries(domain.topology.properties).filter(([, definition]) => relOf(definition) === LinkRelations.CONTEXT.rel);
				const read = await Promise.all(filtered.map(async ([property]) => [property, await store.distinctPropertyValues(label, property)] as const));
				return actionOKWithProducts({ values: Object.fromEntries(read) });
			},
		},
		getClusteredQuads: {
			read: true,
			gwta: "get clustered quads",
			productsDomain: DOMAIN_CLUSTERED_QUADS,
			// The sampled graph is the RPC response; keeping it on the event too holds a second copy of it per call.
			retainProducts: false,
			action: async (args: { perTypeLimit?: number | string; types?: string[] | string; accessLevel?: string; scope?: string } = {}) => {
				const store = this.getWorld().shared.getStore();
				// RPC params arrive stringified through the synthetic-step plumbing; coerce both back to native shapes.
				const limitNum = typeof args.perTypeLimit === "string" ? Number(args.perTypeLimit) : args.perTypeLimit;
				const perTypeLimit = Math.max(1, Math.min(10000, Number.isFinite(limitNum) ? (limitNum as number) : 100));
				// Required, as the dereference and query paths require it: no default ceiling, so the cluster view applies the
				// caller's access exactly. A caller states a QUERY level: `all` asks for everything it may see, and refusing it left
				// the graph view with only the quads that happened to stream live.
				const accessLevel = storeScopeFor(AccessQueryLevelSchema.parse(args.accessLevel));
				// A federated read asks for "own", which is the peer's authoritative data rather than its view of the world (see TClusteredQuadsOpts).
				if (args.scope !== undefined && args.scope !== "own" && args.scope !== "federated")
					return actionNotOK(`getClusteredQuads: scope must be "own" or "federated", got "${args.scope}"`);
				const scope = args.scope as "own" | "federated" | undefined;
				let types: string[] | undefined;
				if (Array.isArray(args.types)) types = args.types;
				else if (typeof args.types === "string" && args.types.length > 0) {
					try {
						const parsed: unknown = JSON.parse(args.types);
						if (Array.isArray(parsed)) types = parsed.map(String);
					} catch (err) {
						this.getWorld().eventLogger.warn(`getClusteredQuads: ignoring non-JSON 'types' param: ${errorDetail(err)}`);
					}
				}
				if (!store.getClusteredQuads) {
					return actionNotOK("QuadStore does not support getClusteredQuads");
				}
				const result = await store.getClusteredQuads({ perTypeLimit, types, accessLevel, scope });
				// The store sample is canonical; the live observation buffer only EXTENDS it through the one shared,
				// limit-bounded merge (dedup by fact, admit-or-omit per type, relabel newcomers). Concatenating the
				// buffer unbudgeted let every observed subject past the requested limit. The client seeds this
				// response verbatim, so the response itself must hold the bound.
				const model = new QuadGraphModel(
					perTypeLimit,
					(type) => this.resourceRels().fields(type),
					(type) => this.resourceRels().titledBy(type),
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
				// The same response carries the schema (Class, Property and rdf:type edges), pruned to the terms the data
				// uses. Its evidence is the response's own quads, which is what the store holds: a fact announced is a
				// fact written, so there is nothing a second buffer would add. The offline report assembles it the same
				// way (buildGraphSource).
				const standardVocab = await enumerateStandardVocab(this.getWorld().domains);
				const withSchema = withOntologySchema({ quads, clusters: model.snapshot.clusters }, quads, this.getWorld().domains, standardVocab);
				return actionOKWithProducts({ ...withSchema, site: activeSitePrincipal(this.getWorld()) });
			},
		},
		clusteredGraphHoldsFromSite: {
			gwta: `clustered graph holds {type: ${DOMAIN_PERSISTED_TYPE}} {subject: ${DOMAIN_RECORD_ID}} from site {site: ${DOMAIN_PRINCIPAL_REF}}`,
			recordIds: { subject: "type" },
			productsDomain: DOMAIN_SUBJECT_SERVED,
			// Federation-health inspection: does this instance's merged view hold {subject} (a {type} individual)
			// SERVED BY {site}? Reads the same clustered surface the views render from, so it asserts exactly what a
			// user would see, including that the subject's stamp names the site that serves it.
			action: async ({ type, subject, site: { id: site } }: { type: string; subject: string; site: TIndividualRef }) => {
				const store = this.getWorld().shared.getStore();
				if (!store.getClusteredQuads) return actionNotOK("QuadStore does not support getClusteredQuads");
				const { clusters } = await store.getClusteredQuads({ perTypeLimit: 1000, accessLevel: Access.private });
				const cluster = clusters.find((c) => c.type === type);
				if (!cluster?.sampledSubjects.includes(subject)) return actionNotOK(`clustered graph holds no ${type} ${subject}`);
				const served = cluster.sites?.[subject];
				return served === site ? actionOKWithProducts({ subject, site }) : actionNotOK(`${subject} is served by ${served ?? "this site (unstamped)"}, not ${site}`);
			},
		},
		federateGraphReads: {
			gwta: `federate graph reads from {where: ${DOMAIN_LINK}}`,
			productsDomain: DOMAIN_SITE_FEDERATED,
			// Reads-first federation: merge a peer instance's clustered graph reads into this one's view, each of the
			// peer's subjects stamped with its site principal so the view can group by site. Site principals must be
			// unique in a federation. Where this instance still carries the default (did:site:0 to itself) and collides
			// with the peer, it asks the peer what it should be called and adopts the answer; an operator-set principal
			// that collides is a configuration error, surfaced as one.
			action: async ({ where }: { where: string }) => {
				const world = this.getWorld();
				const source = new RemoteGraphSource({ url: where, sign: requestSigner(world.runtime) });
				const peer = await source.connect();
				if (peer === activeSitePrincipal(world)) {
					if (!hasDefaultSitePrincipal(world)) return actionNotOK(`federate: site principals collide (${peer}) and this site is operator-named. Set HAIBUN_SITE_KEY uniquely`);
					const assigned = await source.requestName();
					adoptSitePrincipal(world, assigned);
					await persistPrincipalIndividual(world, { id: assigned, controller: assigned, generatedAtTime: new Date().toISOString() });
				}
				const store = world.shared.getStore();
				if (!(store instanceof QuadStore)) return actionNotOK("federate: the world store does not support federation");
				store.federate(source);
				return actionOKWithProducts({ site: peer });
			},
		},
		density: {
			read: true,
			gwta: `run shape {query: ${DOMAIN_DENSITY_QUERY}}`,
			fallback: true,
			productsDomain: DOMAIN_DENSITY,
			// The counts are the answer; keeping them on the event too is the per-read bloat.
			retainProducts: false,
			// The same answer a page counting over its own copy of the graph gives itself, so the two never drift.
			action: async ({ query }: { query: TDensityQuery }) => actionOKWithProducts(await this.getWorld().shared.getStore().density(query)),
		},

		graphQuery: {
			read: true,
			gwta: `graph query {query: ${DOMAIN_GRAPH_QUERY}}`,
			fallback: true,
			productsDomain: DOMAIN_GRAPH_ROWS,
			// The vertex rows are the RPC response; keeping them on the event too is the per-query bloat.
			retainProducts: false,
			// The same answer a page reading its own copy of the graph gives itself, so the two never drift.
			action: async ({ query }: { query: TGraphQuery }) => actionOKWithProducts(await queryQuadStore(this.getWorld().shared.getStore(), query)),
		},
	} satisfies TStepperSteps;
}
