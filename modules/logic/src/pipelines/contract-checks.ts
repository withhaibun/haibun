/**
 * The check of a call against statements of its step's contract, over one rule set generated from the relations of every contract
 * as the steps load. The rule set and its query are translated into the engine's clauses once, on the first check. A check reads
 * from the store each record a call's value refers to, and each record an edge the contract states complete reaches from one it
 * read, and selects the relation triples the clauses derive over the call's facts and those records. A statement holds where its
 * triple is derived. A negated statement holds where its triple isn't derived and the contract states complete each field its
 * relation's rules read: the records read hold those fields in full, so the scope of the negation is complete. A statement that
 * doesn't hold is refuted where its negation's triple is derived, and unknown otherwise; EYE then proves what the query selects
 * over the same facts, so the step's record holds a proof that cites the records the check read.
 */
import type { TProver } from "@haibun/core/lib/actuality/ports.js";
import { VERDICT } from "@haibun/core/lib/domains/protocol.js";
import type { TRelation, TStatementVerdict } from "@haibun/core/lib/steps/domains/contract.js";
import { callFacts, callTriple, fieldPredicate, referencedRecords, relationPredicate, relationReads, relationsQuery, tripleKey } from "../derivations/contract-terms.js";
import { patternText } from "../derivations/n3.js";
import type { TLogicEngine, TReasoner } from "../ports.js";
import { derive } from "./reason.js";
import { translatedChecks } from "./translated.js";
import { namedRecords } from "./reads.js";

/** What a check states the call's facts derive, or don't. */
const DERIVE = "the call's facts derive";
const DONT_DERIVE = "the call's facts don't derive";

/** Returns the check of a call's statements over the rules of `relations`, which every contract's statements name. */
export function contractChecks(relations: readonly TRelation[], reasoner: TReasoner, engine: TLogicEngine): TProver["checkContract"] {
	const rules = relations.map((relation) => relation.rules).join("\n");
	const query = relationsQuery(relations);
	const check = translatedChecks(reasoner, engine);
	const predicates = new Set(relations.map((relation) => relationPredicate(relation).value));
	const reads = relationReads(relations);
	return async (world, { statements, complete }, call) => {
		const triples = statements.map((statement) => ({ statement, triple: callTriple(call, statement) }));
		const held = new Set(complete.map(fieldPredicate));
		const read = await namedRecords(world.shared.getStore(), world.domains, referencedRecords(call, statements), complete);
		const facts = callFacts(call, read);
		const derived = await check(rules, query, facts);
		// The quads of a list state its items through rdf:first and rdf:rest; a relation's triple is a quad of its predicate.
		const selected = new Set(derived.filter(({ predicate }) => predicates.has(predicate.value)).map(({ subject, predicate }) => tripleKey(subject, predicate, derived)));
		const verdicts = triples.map(({ statement, triple }): TStatementVerdict => {
			const text = patternText(triple);
			const holds = selected.has(tripleKey(triple.subject, triple.predicate, derived));
			if (statement.negated) {
				if (holds) return { statement, verdict: VERDICT.refuted, decidedBy: `${DERIVE} ${text}` };
				const readBy = reads.get(statement.relation.name);
				if (readBy === undefined) throw new Error(`a contract's statement names the relation ${statement.relation.name}, which the steppers don't declare`);
				const open = [...readBy].filter((predicate) => !held.has(predicate));
				return open.length === 0
					? { statement, verdict: VERDICT.proved, decidedBy: `${DONT_DERIVE} ${text}, over ${[...readBy].join(", ")}, which the contract states complete` }
					: { statement, verdict: VERDICT.unknown, decidedBy: `${DONT_DERIVE} ${text}, and the contract doesn't state ${open.join(", ")} complete` };
			}
			return holds ? { statement, verdict: VERDICT.proved, decidedBy: `${DERIVE} ${text}` } : { statement, verdict: VERDICT.unknown, decidedBy: `${DONT_DERIVE} ${text}` };
		});
		if (verdicts.every(({ verdict }) => verdict === VERDICT.proved)) return { verdicts };
		return { verdicts, proof: await derive(reasoner, `${rules}\n${facts}`, query, true, {}, "a contract's check reads the call's facts and the records it read") };
	};
}
