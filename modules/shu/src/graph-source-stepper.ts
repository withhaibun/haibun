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
import { fromJsonText } from "@haibun/core/lib/json-text.js";
import { AStepper, type IHasCycles, type IStepperCycles, type TStepperSteps } from "@haibun/core/lib/astepper.js";
import { Access, AccessQueryLevelSchema, DOMAIN_PERSISTED_TYPE, type TDomainDefinition } from "@haibun/core/lib/resources.js";
import { actionNotOK, actionOKWithProducts, errorDetail } from "@haibun/core/lib/util/index.js";
import {
	DOMAIN_GRAPH_QUERY,
	GraphQueryResultSchema,
	type TGraphQuery,
	DOMAIN_DENSITY_QUERY,
	DensityResultSchema,
	type TDensityQuery,
	IndividualWithEdgesSchema,
} from "@haibun/core/lib/quad-types.js";
import { recordWithEdges } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { DOMAIN_RECORD_ID, DOMAIN_LINK, DOMAIN_PRINCIPAL_REF, type TIndividualRef } from "@haibun/core/lib/domains.js";
import { clusteredQuads, federate, selectValues, servingSite } from "./pipelines/graph-source.js";
import { openPeerGraphSource } from "./root.js";

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
			saturated: z.boolean().optional(),
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

/** The parameters a graph view sends `get clustered quads` over RPC. A value may arrive as its text. They state how many
 *  records of each type to read, the types, the query level, and whether a federated read requests the peer's own data
 *  rather than its view of the world (see TClusteredQuadsOpts). Each type's records are a page, so the step rejects a
 *  count above `MAX_PAGE_ROWS`. A page states every parameter but the types and the scope. */
const ClusteredQuadsAskSchema = z.object({
	perTypeLimit: z.coerce.number().int(),
	types: fromJsonText(z.array(z.string())).optional(),
	accessLevel: AccessQueryLevelSchema,
	scope: z.enum(["own", "federated"]).optional(),
});

export default class GraphSourceStepper extends AStepper implements IHasCycles {
	description = "The graph a page reads: a query, a count over a span, the clustered sample a graph view draws, and the reads a federated peer answers.";
	cycles: IStepperCycles = { getConcerns: () => ({ domains: GRAPH_SOURCE_DOMAINS }) };

	steps = {
		getIndividualWithEdges: {
			read: true,
			readsAt: Access.public,
			gwta: `get individual {label: ${DOMAIN_PERSISTED_TYPE}} {id: ${DOMAIN_RECORD_ID}} with edges`,
			recordIds: { id: "label" },
			fallback: true,
			productsDomain: DOMAIN_INDIVIDUAL_WITH_EDGES,
			// A page reads an individual with its edges the same way whatever answers the read. This answers from the store
			// this instance holds, which is what a site without a graph engine of its own has; a deployment that gates a
			// read by what a reader may see declares its own step, and the page reads through that one instead.
			action: async ({ label, id }: { label: string; id: string }) => {
				const held = await recordWithEdges(this.getWorld().shared.getStore(), label, id);
				return held === undefined ? actionNotOK(`${label} ${id} isn't held here`) : actionOKWithProducts(held);
			},
		},
		getSelectValues: {
			read: true,
			readsAt: Access.public,
			gwta: `get select values for {label: ${DOMAIN_PERSISTED_TYPE}}`,
			productsDomain: DOMAIN_SELECT_VALUES,
			action: async ({ label }: { label: string }) => {
				const values = await selectValues(this.getWorld(), label);
				return values === undefined ? actionNotOK(`a filter topology isn't registered for ${label}`) : actionOKWithProducts({ values });
			},
		},
		getClusteredQuads: {
			read: true,
			readsAt: Access.public,
			gwta: "get clustered quads",
			productsDomain: DOMAIN_CLUSTERED_QUADS,
			// The sampled graph is the RPC response; keeping it on the event too holds a second copy of it per call.
			retainProducts: false,
			action: async (asked: Record<string, unknown>) => {
				const read = ClusteredQuadsAskSchema.safeParse(asked);
				if (!read.success) return actionNotOK(`getClusteredQuads: ${z.prettifyError(read.error)}`);
				try {
					return actionOKWithProducts({ ...(await clusteredQuads(this.getWorld(), read.data)) });
				} catch (err) {
					return actionNotOK(`the clustered sample wasn't read: ${errorDetail(err)}`);
				}
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
				const served = await servingSite(this.getWorld(), type, subject, Access.private);
				if (!served.held) return actionNotOK(`the clustered graph doesn't hold ${type} ${subject}`);
				if (served.site === site) return actionOKWithProducts({ subject, site });
				return actionNotOK(`${subject} is served by ${served.site === undefined ? "this site, which doesn't stamp its own subjects" : served.site}, not ${site}`);
			},
		},
		federateGraphReads: {
			gwta: `federate graph reads from {where: ${DOMAIN_LINK}}`,
			productsDomain: DOMAIN_SITE_FEDERATED,
			// Reads-first federation: a peer instance's clustered reads merge into this one's view, each of the peer's subjects
			// stamped with its site principal, so the view groups by site.
			action: async ({ where }: { where: string }) => {
				try {
					return actionOKWithProducts({ site: await federate(this.getWorld(), openPeerGraphSource, where) });
				} catch (err) {
					return actionNotOK(`the graph reads of ${where} weren't federated: ${errorDetail(err)}`);
				}
			},
		},
		density: {
			read: true,
			readsAt: Access.public,
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
			readsAt: Access.public,
			gwta: `graph query {query: ${DOMAIN_GRAPH_QUERY}}`,
			fallback: true,
			productsDomain: DOMAIN_GRAPH_ROWS,
			// The vertex rows are the RPC response; keeping them on the event too is the per-query bloat.
			retainProducts: false,
			// The same answer a page reading its own copy of the graph gives itself, so the two never drift.
			action: async ({ query }: { query: TGraphQuery }) => actionOKWithProducts(await this.getWorld().shared.getStore().readRecords(query)),
		},
	} as const satisfies TStepperSteps;
}
