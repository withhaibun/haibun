/**
 * Checks on the engine that runs haibun.pl, over the clauses EYE's translation generated from N3 rule sets. A rule set and its query
 * are translated when a check first reads them, and their clauses load into the engine once, in a module named by the digest of
 * their text. A check asserts its facts in that module, reads the triples the query selects, and retracts the facts.
 */
import type { Quad } from "@rdfjs/types";
import { LOG } from "@haibun/core/lib/domains/vocabularies.js";
import { sha256 } from "@haibun/core/lib/domains/digest.js";
import { quadsOf } from "../derivations/n3.js";
import { factTermOf } from "../domains/prolog-terms.js";
import type { TLogicEngine, TReasoner } from "../ports.js";

/** The length of the digest prefix that names a translation's module. */
const MODULE_DIGEST = 16;

/** Returns the fact/3 terms of the ground triples of N3 text: each triple outside a formula, other than a rule. */
export const factsOf = (text: string): string[] =>
	quadsOf(text)
		.filter((quad) => quad.graph.termType === "DefaultGraph" && quad.predicate.value !== LOG.implies)
		.map((quad) => `fact(${factTermOf(quad.predicate)}, ${factTermOf(quad.subject)}, ${factTermOf(quad.object)})`);

/** A check over translated clauses: the rule set, its query and the facts it reads, each as N3. Returns the triples the query selects. */
export type TTranslatedCheck = (rules: string, query: string, facts: string) => Promise<Quad[]>;

/** Returns the checks over the clauses `reasoner` translates and `engine` loads. A rule set that doesn't translate rejects each of
 *  its checks with the rules the translation refused. */
export function translatedChecks(reasoner: Pick<TReasoner, "translate">, engine: TLogicEngine): TTranslatedCheck {
	const loaded = new Map<string, Promise<string>>();
	const moduleOf = (rules: string, query: string): Promise<string> => {
		const module = `n3_${sha256(`${rules}\n${query}`).slice(0, MODULE_DIGEST)}`;
		const held = loaded.get(module);
		if (held !== undefined) return held;
		const loading = reasoner.translate(rules, query, module).then((translation) => {
			engine.load(translation);
			return module;
		});
		loaded.set(module, loading);
		return loading;
	};
	return async (rules, query, facts) => quadsOf(engine.select(await moduleOf(rules, query), factsOf(facts)));
}
