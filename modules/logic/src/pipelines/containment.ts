/**
 * Proves a permission's containment in its bound through the reasoner: a delegation in its parent, a grant in its grantor's, a
 * narrowed statement in its caller, and a use in the capability on which it rests. The proof states what the candidate holds beyond
 * its bound, or its containment.
 */
import type { TExceeding, TPermission } from "@haibun/core/lib/domains/actions.js";
import type { TProof } from "../domains/reasoning.js";
import { CONTAINMENT_QUERY, CONTAINMENT_RULES, containmentFacts, exceedingOf } from "../derivations/containment.js";
import { proofOf } from "../derivations/proof.js";
import type { TReasoner } from "../ports.js";

/** Returns what `candidate` holds beyond `bound`, which is empty where the bound contains it, and the proof of either. */
export async function containment(reasoner: TReasoner, candidate: TPermission, bound: TPermission): Promise<{ exceeds: TExceeding[]; proof: TProof }> {
	const derived = await reasoner.session(async (session) => {
		const state = await session.start(`${CONTAINMENT_RULES}\n${containmentFacts(candidate, bound)}`, CONTAINMENT_QUERY, true);
		if ("need" in state)
			throw new Error(`a containment reads only its own facts, and its rules reached a read of ${state.predicate.value} of ${state.subject.value}. Check the containment rules.`);
		return state.derived;
	});
	const proof = proofOf(derived);
	return { exceeds: exceedingOf(proof.gives), proof };
}
