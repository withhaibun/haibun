/**
 * The page's calls of actuality's steps (`page/pipelines/call-step.ts`) and its reads of actuality's records
 * (`page/pipelines/read-records.ts`), as a view and a read take them: a read calls the site, and reads the graph the page
 * holds where the site doesn't respond.
 */
import type { TDensityQuery, TDensityResult, TGraphQueryResult, TIncomingEdges, TIndividualWithEdges, TQuad } from "@haibun/core/lib/quad-types.js";
import { pageConduit, pageHydration, pageRegistry, registryScope } from "../root.js";
import { readSteps } from "../pipelines/read-steps.js";
import { heldCatalog } from "../pipelines/held-catalog.js";
import * as Reads from "../pipelines/read-records.js";
import * as CallStep from "../pipelines/call-step.js";
import type { TCallLink } from "@haibun/core/lib/domains/hypermedia.js";
import { RPC_METHOD } from "../../domains/elements.js";
import { cachedGraph, readsHeldGraph } from "../client-cache/controllers/device-controller.js";
import { appAccessLevel } from "./view-query-controller.js";
import type { TActualityGraph } from "../client-cache/ports.js";

/** What a read reads. A page that carries a record of actuality, or reads another actuality's records, reads what it holds. */
const scope = (): Reads.TReadScope => ({
	readsSite: pageHydration().carried() === undefined && !readsHeldGraph(),
	steps: () => readSteps(registryScope()),
	conduit: pageConduit,
	catalog: () => heldCatalog(pageRegistry(), "the catalog a read of the records reads"),
	held: cachedGraph,
});

/** What a call reads: actuality's steps, the conduit, and what a carried record of actuality's step produced. */
const callScope = (): CallStep.TCallScope => ({ steps: () => readSteps(registryScope()), conduit: pageConduit, carried: (method) => pageHydration().carriedProducts(method) });

/** Calls the step `step` names with `params`, and returns what the step returned, or the refusal. */
export const callStep = <T>(step: string, params: Record<string, unknown>, why: string): Promise<CallStep.TCallOutcome<T>> => CallStep.callStep<T>(callScope(), step, params, why);

/** Follows a call a record links, and returns what the call returned. Throws the call's failure. */
export const followCall = <T>(link: TCallLink, why: string): Promise<T> => CallStep.followCall<T>(callScope(), link, why);

/** Returns the affordances on offer, as a read: at the moment `asOf` names, or now. */
export const affordancesOnOffer = (asOf: string | undefined): Promise<CallStep.TCallOutcome<Record<string, unknown>>> =>
	asOf === undefined
		? callStep(RPC_METHOD.AFFORDANCES_ON_OFFER, {}, "the affordances on offer")
		: callStep(RPC_METHOD.AFFORDANCES_ON_OFFER_AS_OF, { asOf }, `the affordances on offer as of ${asOf}`);

/** Returns the records related to a record, `depth` edges away, and the root record of their thread. */
export const relatedRecords = <V>(label: string, id: string, depth: number): Promise<CallStep.TCallOutcome<{ items: V[]; contextRoot: string }>> =>
	callStep(RELATED_STEP, { label, id, depth }, `the records related to ${label}:${id}`);

/** Returns a sample of the quads of each type, `perTypeLimit` of each, at the page's access level. */
export const clusteredQuads = (perTypeLimit: number): Promise<CallStep.TCallOutcome<{ quads: TQuad[] }>> =>
	callStep(RPC_METHOD.CLUSTERED_QUADS, { perTypeLimit, accessLevel: appAccessLevel() }, `a sample of ${perTypeLimit} quads of each type`);

/** The step that reads the records related to a record. */
const RELATED_STEP = "getRelated";

/** How many records a list of a type's records holds. */
const LIST_LIMIT = 100;

/** Returns the rows a graph query names. */
export const queryGraph = (query: Record<string, unknown>): Promise<TGraphQueryResult> => Reads.queryGraph(scope(), query);

/** Returns a record with its edges, at `accessLevel`. */
export const readIndividual = (label: string, id: string, accessLevel: string): Promise<TIndividualWithEdges> => Reads.readIndividual(scope(), label, id, accessLevel);

/** Returns a record with its edges, at `accessLevel`, or the refusal. */
export const recordReadAt = (label: string, id: string, accessLevel: string): Promise<CallStep.TCallOutcome<TIndividualWithEdges>> =>
	CallStep.outcomeOf(() => readIndividual(label, id, accessLevel));

/** Returns a record with its edges, at the page's access level, or the refusal. */
export const recordRead = (label: string, id: string): Promise<CallStep.TCallOutcome<TIndividualWithEdges>> => recordReadAt(label, id, appAccessLevel());

/** Returns the rows a graph query names, or the refusal. */
export const queryRead = (query: Record<string, unknown>): Promise<CallStep.TCallOutcome<TGraphQueryResult>> => CallStep.outcomeOf(() => queryGraph(query));

/** Returns the edges that reach a record, in `window`, at the page's access level, or the refusal. */
export const incomingRead = (label: string, id: string, window: Reads.TEdgeWindow): Promise<CallStep.TCallOutcome<TIncomingEdges>> =>
	CallStep.outcomeOf(() => incomingEdges(label, id, window));

/** Returns the edges that reach a record, in `window`, at the page's access level. */
export const incomingEdges = (label: string, id: string, window: Reads.TEdgeWindow): Promise<TIncomingEdges> => Reads.incomingEdges(scope(), label, id, appAccessLevel(), window);

/** Returns a type's select values, by field. */
export const selectValuesFor = (label: string): Promise<Record<string, string[]>> => Reads.selectValuesFor(scope(), label);

/** Returns how many records fall in each division of a span, by how each turned out. */
export const densityOf = (query: TDensityQuery): Promise<TDensityResult> => Reads.densityOf(scope(), query);

/** Returns a bounded list of a type's records at the page's access level, or the refusal. `why` states the read. */
export async function listRecords(label: string, why: string): Promise<CallStep.TCallOutcome<TGraphQueryResult>> {
	const listed = await CallStep.outcomeOf(() => queryGraph({ label, accessLevel: appAccessLevel(), limit: LIST_LIMIT }));
	return listed.ok ? listed : { ok: false, refusal: { ...listed.refusal, error: `${why}: ${listed.refusal.error}` } };
}

/** Returns actuality as the page reads it: what the site returns, and what the page holds where the site doesn't respond. A view
 *  reads actuality through it where the view is made. */
export const pageActualityGraph = (): TActualityGraph => ({
	query: queryGraph,
	density: densityOf,
	declares: (label) => heldCatalog(pageRegistry(), `whether the catalog declares ${label}`).rels[label] !== undefined,
});
