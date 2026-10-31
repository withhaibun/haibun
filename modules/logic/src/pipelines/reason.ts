/**
 * Reasons over N3 rules through the reasoner. Each type whose graph the rules close over is stated as one formula of its
 * records, `<class> h:complete { … }`, and only a type that declares its graph complete is stated so, since scoped negation
 * over an open graph would take an unproved claim as false. Every other fact is read through the read built-in, where a fact
 * the store doesn't hold leaves a claim unproved. A read runs under the caller's authority, as a proof's read does. A graph is
 * complete only to a reader at or above its type's access level, which is the narrowest level that holds its records. A
 * reader below that level reads part of the graph, so for that reader the graph is open and isn't stated as a formula: a
 * claim its records don't prove stays unknown. A complete graph is read in pages up to a ceiling, and a graph whose read stops
 * there is open as well. An explained reasoning returns the proof of what its query selects and names the
 * graphs that stayed open to the reader, so a verdict carries how it was reached and why a claim stayed unknown.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { withinAccess, type TRecordNamespace, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { persistedDomainOf } from "@haibun/core/lib/domains/domains.js";
import { readingAt } from "@haibun/core/lib/domains/capability-context.js";
import type { NamedNode, Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { COMPLETE_GRAPH, neededBy, REASONING_READ_CEILING, type TExplained, type TOpenGraph, type TReasoning, type TReasonerValue } from "../domains/reasoning.js";
import { patternText, quadsOf, recordTerms } from "../derivations/n3.js";
import { proofOf } from "../derivations/proof.js";
import type { TReasoner } from "../ports.js";
import { readerOf } from "./reads.js";

/** Returns the triples a reasoning's query selects from what its rules derive over the store. */
export async function reason(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	reasoning: TReasoning,
): Promise<Quad[]> {
	return quadsOf((await reasoned(reasoner, store, domains, records, reasoning, false)).derived);
}

/** Returns the proof of what a reasoning's query selects, and the graphs its rules close over that are open to the reader. */
export async function explain(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	reasoning: TReasoning,
): Promise<TExplained> {
	const { derived, open } = await reasoned(reasoner, store, domains, records, reasoning, true);
	return { proof: proofOf(derived), open };
}

/** How a session's needs are performed: a read of the store's facts of a subject and a predicate, and an effect of a proof. A
 *  need its caller doesn't perform is refused, naming the need. */
export type TSessionNeeds = {
	read?: (subject: NamedNode, predicate: NamedNode) => Promise<readonly TReasonerValue[]>;
	effect?: (request: readonly TReasonerValue[]) => Promise<readonly TReasonerValue[]>;
};

/** Runs one session of `reasoner` over `sources` and `query`, performing each need through `needs`, and returns what EYE printed.
 *  A need `needs` doesn't perform throws, stating `what`, the limit of what the session reads, and the need its rules reached. */
export function derive(reasoner: TReasoner, sources: string, query: string, explained: boolean, needs: TSessionNeeds, what: string): Promise<string> {
	return reasoner.session(async (session) => {
		let state = await session.start(sources, query, explained);
		while ("need" in state) {
			const performed = state.need === "read" ? needs.read?.(state.subject, state.predicate) : needs.effect?.(state.request);
			if (performed === undefined) throw new Error(`${what}, and its rules reached ${neededBy(state)}. Check its rules.`);
			state = await session.resume(await performed);
		}
		return state.derived;
	});
}

/** Runs a reasoning's session, stating each graph it closes over that is complete to the reader as one formula, and returns
 *  what EYE printed and the graphs it closes over that are open to the reader. */
async function reasoned(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	{ ruleSets, rules, query, closedOver }: TReasoning,
	explained: boolean,
): Promise<{ derived: string; open: TOpenGraph[] }> {
	const ceiling = readingAt();
	const closing = closedOver.map((label) => {
		const topology = persistedDomainOf(domains, label)?.topology;
		if (topology?.complete !== true)
			throw new Error(
				`the rules close over ${label}, whose type doesn't declare its graph complete. Declare \`complete: true\` on ${label}'s topology, or read its facts with h:read.`,
			);
		return { graph: label, accessLevel: topology.accessLevel, complete: ceiling === undefined || withinAccess(topology.accessLevel, ceiling) };
	});
	const terms = recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains, undefined, records)["@context"], records);
	const reader = readerOf(store);
	// A graph complete to the reader is read up to the ceiling; one whose read stopped there is open, and isn't stated.
	const reads = await Promise.all(closing.filter(({ complete }) => complete).map(async ({ graph }) => ({ graph, ...(await reader.records(graph)) })));
	const formulas = reads.flatMap(({ graph, facts, truncated }) =>
		truncated ? [] : [patternText({ subject: terms.classIri(graph), predicate: DataFactory.namedNode(COMPLETE_GRAPH), object: { formula: terms.statements(graph, facts) } })],
	);
	const open: TOpenGraph[] = [
		...closing.flatMap(({ graph, accessLevel, complete }) => (complete ? [] : [{ graph, accessLevel }])),
		...reads.flatMap(({ graph, truncated }) => (truncated ? [{ graph, readCeiling: REASONING_READ_CEILING }] : [])),
	];
	const read = async (subject: NamedNode, predicate: NamedNode) => (await reader.facts(terms.patternOf(subject, predicate))).map(terms.objectOf);
	const derived = await derive(reasoner, [...ruleSets.map(reasoner.rules), rules, ...formulas].join("\n"), query, explained, { read }, "a reasoning reads the store");
	return { derived, open };
}
