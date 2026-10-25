/**
 * The page's reads of actuality's records, each routed to the site or the device (CA4F4): the graph query, a record with
 * its edges, the edges that reach a record, a type's select values, and a span's shape. A read calls the site, and where
 * the site doesn't respond, reads the graph the page holds through the function by which the site reads its own store. A
 * site's refusal is what it returns, a record it doesn't hold among them. The page reads what it holds only of a type the
 * catalog declares, and otherwise the site's failure is what the read throws.
 */
import { z } from "zod";
import { GraphQuerySchema, type TDensityQuery, type TDensityResult, type TGraphQueryResult, type TIncomingEdges, type TIndividualWithEdges } from "@haibun/core/lib/quad-types.js";
import { type IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { incomingEdges as incomingEdgesHeld, recordWithEdges } from "@haibun/core/lib/records/pipelines/record-reads.js";
import { isServerUnreachable } from "@haibun/core/lib/rpc-wire.js";
import { LIMITED_TO_METHOD, SKIPPING_METHOD } from "@haibun/core/lib/step-discovery.js";
import * as Steps from "../derivations/steps.js";
import { selectFields, type TCatalog } from "../derivations/catalog.js";
import { reads } from "../domains/links.js";
import type { TStepList } from "../machines/registry.js";
import type { TConduit } from "../ports.js";

/** What a read reads: whether the page reads the site, actuality's steps, the conduit, the catalog, and the graph the page
 *  holds. A page that carries a record of actuality, or reads another actuality's records, reads only what it holds. */
export type TReadScope = { readsSite: boolean; steps: () => Promise<TStepList>; conduit: () => TConduit; catalog: () => TCatalog; held: () => IQuadStore };

/** The window of the edges that reach a record. */
export type TEdgeWindow = { limit: number; offset: number };

/** The step by which a site offers a type's select values. */
const SELECT_VALUES_STEP = "getSelectValues";

/** The select values a site returns, by field. */
const SelectValuesSchema = z.object({ values: z.record(z.string(), z.array(z.string())) });

/** Returns what the site returns through `ask`, and where the site doesn't respond, what the page holds through `held`.
 *  `held` returns undefined where the page doesn't hold the records, and the site's failure is then thrown. */
async function askElseHeld<T>(scope: TReadScope, ask: (list: TStepList) => Promise<T>, held: () => Promise<T | undefined>): Promise<T> {
	let failure: unknown = new Error("this page doesn't hold that record of the actuality it reads");
	if (scope.readsSite) {
		try {
			return await ask(await scope.steps());
		} catch (err) {
			if (!isServerUnreachable(err)) throw err;
			failure = err;
		}
	}
	const own = await held();
	if (own === undefined) throw failure;
	return own;
}

/** Whether the catalog declares the type `label`, whose records the page reads where the site doesn't respond. */
const declares = (scope: TReadScope, label: string): boolean => scope.catalog().rels[label] !== undefined;

/** Returns the rows a graph query names. */
export function queryGraph(scope: TReadScope, query: Record<string, unknown>): Promise<TGraphQueryResult> {
	const label = typeof query.label === "string" ? query.label : undefined;
	return askElseHeld(
		scope,
		(list) => scope.conduit().follow<TGraphQueryResult>(reads(Steps.methodOf(list, "graphQuery"), { query }), `query: ${label === undefined ? "(any)" : label}`),
		async () => {
			const parsed = GraphQuerySchema.safeParse(query);
			return parsed.success && parsed.data.label !== undefined && declares(scope, parsed.data.label) ? await scope.held().readRecords(parsed.data) : undefined;
		},
	);
}

/** Returns a record with its edges. */
export const readIndividual = (scope: TReadScope, label: string, id: string, accessLevel: string): Promise<TIndividualWithEdges> =>
	askElseHeld(
		scope,
		(list) => scope.conduit().follow<TIndividualWithEdges>(reads(Steps.methodOf(list, "getIndividualWithEdges"), { label, id, accessLevel }), `read ${label}:${id}`),
		() => recordWithEdges(scope.held(), label, id),
	);

/** Returns the edges that reach a record, in `window`. The page reads the window before it reads a record, so a hub reads a
 *  window of its edges rather than each of them. */
export const incomingEdges = (scope: TReadScope, label: string, id: string, accessLevel: string, window: TEdgeWindow): Promise<TIncomingEdges> =>
	askElseHeld(
		scope,
		(list) => {
			const read = { method: Steps.methodOf(list, "getIncomingEdges"), params: { label, id, accessLevel } };
			const windowed = { count: window.limit, statement: { method: SKIPPING_METHOD, params: { count: window.offset, statement: read } } };
			return scope.conduit().follow<TIncomingEdges>(reads(LIMITED_TO_METHOD, windowed), `what points at ${label}:${id}`);
		},
		async () => (declares(scope, label) ? await incomingEdgesHeld(scope.held(), label, id, window) : undefined),
	);

/** Returns a type's select values, by field: what the site returns, and where the site doesn't respond, the distinct values
 *  each field the type offers as a dropdown holds in the graph the page holds. A site whose steps don't offer the values
 *  offers a dropdown without values, and the reader types the value. */
export const selectValuesFor = (scope: TReadScope, label: string): Promise<Record<string, string[]>> =>
	askElseHeld(
		scope,
		async (list) =>
			Steps.stepNamed(list, SELECT_VALUES_STEP) === undefined
				? {}
				: SelectValuesSchema.parse(await scope.conduit().follow<unknown>(reads(Steps.methodOf(list, SELECT_VALUES_STEP), { label }), `select values for ${label}`)).values,
		async () => {
			if (!declares(scope, label)) return undefined;
			const values: Record<string, string[]> = {};
			for (const field of selectFields(scope.catalog(), label)) values[field] = (await scope.held().distinctPropertyValues(label, field)).values;
			return values;
		},
	);

/** Returns how many records fall in each division of a span, by how each turned out. The site counts over the whole of
 *  actuality it holds, and a page without a site counts over what it has read. */
export const densityOf = (scope: TReadScope, query: TDensityQuery): Promise<TDensityResult> =>
	askElseHeld(
		scope,
		(list) => scope.conduit().follow<TDensityResult>(reads(Steps.methodOf(list, "density"), { query }), `the shape of ${query.label}`),
		async () => (declares(scope, query.label) ? await scope.held().density(query) : undefined),
	);
