/**
 * The check of a call against statements of its step's contract, over one rule set generated from the relations of every contract
 * as the steps load. The rule set and its query are translated into the engine's clauses once, on the first check, and each check
 * selects the relation triples the clauses derive over the call's facts. A statement holds where its triple is derived, and a
 * negated statement where it isn't, over the call's facts, which a check reads as complete. A statement that doesn't hold is
 * refuted where its negation's triple is derived, and unknown where its triple isn't; EYE then proves what the query selects over
 * the same facts, and the step's record holds that proof.
 */
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import type { TRelation, TStatementVerdict } from "@haibun/core/lib/steps/domains/contract.js";
import { callFacts, relationPredicate, relationsQuery, statementTriple, tripleKey } from "../derivations/contract-terms.js";
import { patternText } from "../derivations/n3.js";
import type { TLogicEngine, TReasoner } from "../ports.js";
import { derive } from "./reason.js";
import { translatedChecks } from "./translated.js";

/** What a check states the call's facts derive, or don't. */
const DERIVE = "the call's facts derive";
const DONT_DERIVE = "the call's facts don't derive";

/** Returns the check of a call's statements over the rules of `relations`, which every contract's statements name. */
export function contractChecks(relations: readonly TRelation[], reasoner: TReasoner, engine: TLogicEngine): TProver["checkContract"] {
	const rules = relations.map((relation) => relation.rules).join("\n");
	const query = relationsQuery(relations);
	const check = translatedChecks(reasoner, engine);
	const predicates = new Set(relations.map((relation) => relationPredicate(relation).value));
	return async (statements, call) => {
		const triples = statements.map((statement) => ({ statement, triple: statementTriple(call, statement) }));
		const facts = callFacts(call);
		const derived = await check(rules, query, facts);
		// The quads of a list state its items through rdf:first and rdf:rest; a relation's triple is a quad of its predicate.
		const held = new Set(derived.filter(({ predicate }) => predicates.has(predicate.value)).map(({ subject, predicate }) => tripleKey(subject, predicate, derived)));
		const verdicts = triples.map(({ statement, triple }): TStatementVerdict => {
			const text = patternText(triple);
			const holds = held.has(tripleKey(triple.subject, triple.predicate, derived));
			if (statement.negated)
				return holds
					? { statement, verdict: VERDICT.refuted, decidedBy: `${DERIVE} ${text}` }
					: { statement, verdict: VERDICT.proved, decidedBy: `${DONT_DERIVE} ${text}, which the check reads as complete` };
			return holds ? { statement, verdict: VERDICT.proved, decidedBy: `${DERIVE} ${text}` } : { statement, verdict: VERDICT.unknown, decidedBy: `${DONT_DERIVE} ${text}` };
		});
		if (verdicts.every(({ verdict }) => verdict === VERDICT.proved)) return { verdicts };
		return { verdicts, proof: await derive(reasoner, `${rules}\n${facts}`, query, true, {}, "a contract's check reads only the call's facts") };
	};
}
