/**
 * Reasons over N3 rules through the reasoner. Each type whose graph the rules close over is stated as one formula of its
 * records, `<class> h:complete { … }`, and only a type that declares its graph complete is stated so, since scoped negation
 * over an open graph would take an unproved claim as false. Every other fact is read through the read built-in, where a fact
 * the store doesn't hold leaves a claim unproved. A read runs under the caller's authority, as a proof's read does.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { buildConcernCatalog, getJsonLdContext } from "@haibun/core/lib/domains/hypermedia.js";
import { isPersisted, type TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import { COMPLETE_GRAPH, type TReasoning, type TTriple } from "../domains/reasoning.js";
import { recordTerms, triplesOf } from "../derivations/n3.js";
import type { TReasoner } from "../ports.js";
import { readerOf } from "./reads.js";

/** Returns the triples a reasoning's query selects from what its rules derive over the store. */
export async function reason(reasoner: TReasoner, store: IQuadStore, domains: Record<string, TRegisteredDomain>, { rules, query, closedOver }: TReasoning): Promise<TTriple[]> {
	const declared = Object.values(domains).flatMap(({ topology }) => (isPersisted(topology) ? [topology] : []));
	for (const label of closedOver) {
		const topology = declared.find(({ persistedAs }) => persistedAs === label);
		if (topology?.complete !== true)
			throw new Error(
				`the rules close over ${label}, whose type doesn't declare its graph complete. Declare \`complete: true\` on ${label}'s topology, or read its facts with h:read.`,
			);
	}
	const terms = recordTerms(buildConcernCatalog(domains), getJsonLdContext(domains)["@context"]);
	const reader = readerOf(store);
	const formulas = await Promise.all(
		closedOver.map(async (label) => `<${terms.classIri(label)}> <${COMPLETE_GRAPH}> {\n${terms.statements(label, await reader.facts({ namedGraph: label }))}\n} .`),
	);
	const derived = await reasoner.session(async (session) => {
		let state = await session.start([rules, ...formulas].join("\n"), query);
		while ("need" in state) {
			const facts = await reader.facts(terms.patternOf(state.subject, state.predicate));
			state = session.resume(facts.map(terms.objectOf));
		}
		return state.derived;
	});
	return triplesOf(derived);
}
