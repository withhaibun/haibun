/**
 * Reasons over N3 rules through the reasoner. Each type whose graph the rules close over is stated as one formula of its
 * records, `<class> h:complete { … }`, and only a type that declares its graph complete is stated so, since scoped negation
 * over an open graph would take an unproved claim as false. Every other fact is read through the read built-in, where a fact
 * the store doesn't hold leaves a claim unproved. A read runs under the caller's authority, as a proof's read does. A graph is
 * complete only to a reader at or above its type's access level, which is the narrowest level that holds its records. A
 * reader below that level reads part of the graph, so for that reader the graph is open and isn't stated as a formula: a
 * claim its records don't prove stays unknown. An explained reasoning returns the proof of what its query selects and names the
 * graphs that stayed open to the reader, so a verdict carries how it was reached and why a claim stayed unknown.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { isPersisted, withinAccess, type TRecordNamespace, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { readingAt } from "@haibun/core/lib/domains/capability-context.js";
import { COMPLETE_GRAPH, type TExplained, type TOpenGraph, type TReasoning, type TTriple } from "../domains/reasoning.js";
import { recordTerms, triplesOf } from "../derivations/n3.js";
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
): Promise<TTriple[]> {
	return triplesOf((await reasoned(reasoner, store, domains, records, reasoning, false)).derived);
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

/** Runs a reasoning's session, stating each graph it closes over that is complete to the reader as one formula, and returns
 *  what EYE printed and the graphs it closes over that are open to the reader. */
async function reasoned(
	reasoner: TReasoner,
	store: IQuadStore,
	domains: Record<string, TRegisteredDomain>,
	records: TRecordNamespace,
	{ rules, query, closedOver }: TReasoning,
	explained: boolean,
): Promise<{ derived: string; open: TOpenGraph[] }> {
	const declared = Object.values(domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology] : []));
	const ceiling = readingAt();
	const closing = closedOver.map((label) => {
		const topology = declared.find(({ persistedAs }) => persistedAs === label);
		if (topology?.complete !== true)
			throw new Error(
				`the rules close over ${label}, whose type doesn't declare its graph complete. Declare \`complete: true\` on ${label}'s topology, or read its facts with h:read.`,
			);
		return { graph: label, accessLevel: topology.accessLevel, complete: ceiling === undefined || withinAccess(topology.accessLevel, ceiling) };
	});
	const terms = recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains, undefined, records)["@context"], records);
	const reader = readerOf(store);
	const formulaOf = async (graph: string) => `<${terms.classIri(graph)}> <${COMPLETE_GRAPH}> {\n${terms.statements(graph, await reader.facts({ namedGraph: graph }))}\n} .`;
	const formulas = await Promise.all(closing.filter(({ complete }) => complete).map(({ graph }) => formulaOf(graph)));
	const derived = await reasoner.session(async (session) => {
		let state = await session.start([rules, ...formulas].join("\n"), query, explained);
		while ("need" in state) {
			const facts = await reader.facts(terms.patternOf(state.subject, state.predicate));
			state = session.resume(facts.map(terms.objectOf));
		}
		return state.derived;
	});
	return { derived, open: closing.flatMap(({ graph, accessLevel, complete }) => (complete ? [] : [{ graph, accessLevel }])) };
}
