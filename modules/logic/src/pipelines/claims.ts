/**
 * The claims, each an entailment check through the reasoner: an instance check of ClassAssertion(E X), a subsumption check of
 * SubClassOf(E1 E2), and an instance retrieval of the named individuals entailed to be an E. A claim holds where K, the ontology
 * with the class axioms of the vocabularies a deployment declares and the records the reasoner read, entails its axiom, is refuted where K entails
 * its contradiction, as a membership of two disjoint classes, and is unknown where K doesn't entail the axiom and
 * doesn't contradict it. Each returns its result with what it checks, its verdict and its proof or witness.
 */
import type { IQuadStore } from "@haibun/core/lib/steps/ports.js";
import { VERDICT, type TActionResult } from "@haibun/core/lib/domains/protocol.js";
import type { TRecordNamespace, TRegisteredDomain } from "@haibun/core/lib/domains/resources.js";
import type { TIndividualAddress } from "@haibun/core/lib/domains/typed-links.js";
import type { TEntailment } from "@haibun/core/lib/records/domains/claim.js";
import type { TDisjointnessWitness } from "@haibun/core/lib/records/domains/axioms.js";
import { UNDETERMINED, claimResult, entailmentOf } from "@haibun/core/lib/records/derivations/claim.js";
import type { TReasoner } from "../ports.js";
import {
	addressText,
	checkedExpression,
	countedMembers,
	disjointExpressions,
	entailedMembers,
	membershipProof,
	membershipRefuted,
	queryBasis,
	subsumes,
	subsumptionWitness,
	truncationOf,
} from "./members.js";

/** What a claim reads: the reasoner, the store, the declarations and the records' namespace, under the caller's authority. */
export type TClaimScope = { reasoner: TReasoner; store: IQuadStore; domains: Record<string, TRegisteredDomain>; records: TRecordNamespace };

/** A claim by the terms its line states: an individual and a class expression, two class expressions, or one. */
export type TClaimTerms = { individual: string; expression: string } | { sub: string; sup: string } | { some: string };

/** What a claim the records don't prove leads a reader to do: state the fact, or read a graph that is complete. */
const UNKNOWN_REMEDY = "Add the fact, or read a complete graph.";
/** The proof of a claim the reasoner entails: the rules it read and what it read them over. */
const ENTAILED_BY = "the reasoner entails it under the rules of OWL 2 RL from the ontology and the records it read under the caller's authority";

/** The proof of a claim K contradicts, before the axioms the reasoner's proof of the contradiction read. */
const REFUTED_BY = "the reasoner entails its contradiction under the rules of OWL 2 RL, since a member is entailed a member of two disjoint classes (the rule cax-dw), from";

/** Returns what a claim checks, its class expressions checked against the ontology. */
export function claimEntailment(terms: TClaimTerms, domains: Record<string, TRegisteredDomain>): TEntailment {
	const basis = queryBasis(domains);
	const checked = (text: string) => checkedExpression(text, basis);
	if ("individual" in terms) return entailmentOf({ individual: terms.individual, type: checked(terms.expression) });
	if ("sub" in terms) return entailmentOf({ sub: checked(terms.sub), sup: checked(terms.sup) });
	return entailmentOf({ some: checked(terms.some) });
}

/** Checks ClassAssertion(E X): holds where the reasoner entails the record at `address` as a member of `expression`, its proof
 *  naming the premises the reasoner read, such as the shared value of an inverse functional property that makes two individuals
 *  the same. */
export async function instanceChecked(scope: TClaimScope, address: TIndividualAddress, expression: string): Promise<TActionResult> {
	const entailment = claimEntailment({ individual: addressText(address), expression }, scope.domains);
	const entailed = await membershipProof(scope.reasoner, scope.store, scope.domains, scope.records, address, expression);
	if (entailed.premises !== undefined) return claimResult(entailment, VERDICT.proved, `${ENTAILED_BY}: its proof reads ${entailed.premises.join(", ")}`);
	const refuting = await membershipRefuted(scope.reasoner, scope.store, scope.domains, scope.records, address, expression);
	if (refuting !== undefined) {
		const witness: TDisjointnessWitness = { individual: address, disjoint: refuting.disjoint.classes, statedBy: refuting.disjoint.statedBy };
		return claimResult(entailment, VERDICT.refuted, `${REFUTED_BY} ${refuting.axioms.join(", ")}`, { witness });
	}
	return claimResult(entailment, VERDICT.unknown, `${UNDETERMINED}.${truncationOf(entailed)} ${UNKNOWN_REMEDY}`);
}

/** Checks SubClassOf(E1 E2): holds where the ontology entails that every member of `sub` is a member of `sup`, and is refuted where
 *  K entails a member of `sub` and that a member of `sub` isn't a member of `sup`. Where it doesn't hold, its products hold the
 *  witness: the subsumption and the entailed members of `sub` that `sup` doesn't hold. */
export async function subsumptionChecked(scope: TClaimScope, sub: string, sup: string): Promise<TActionResult> {
	const entailment = claimEntailment({ sub, sup }, scope.domains);
	const read = [scope.reasoner, scope.store, scope.domains, scope.records, sub, sup] as const;
	if (await subsumes(...read))
		return claimResult(entailment, VERDICT.proved, `${ENTAILED_BY}: an individual that stands for any member of the first expression is entailed a member of the second`);
	const { exceeding, witness } = await subsumptionWitness(...read);
	const refuting = witness.members.length === 0 ? undefined : await disjointExpressions(...read);
	if (refuting !== undefined) return claimResult(entailment, VERDICT.refuted, `${REFUTED_BY} ${refuting.axioms.join(", ")}, and ${exceeding}`, { witness });
	return claimResult(entailment, VERDICT.unknown, `${UNDETERMINED}, and ${exceeding}. State the subsumption in the ontology, or narrow the first expression.`, { witness });
}

/** Retrieves the named individuals entailed to be members of `expression`: holds where there is one, which is its witness, and
 *  its products hold the members. */
export async function retrievalChecked(scope: TClaimScope, expression: string): Promise<TActionResult> {
	const entailment = claimEntailment({ some: expression }, scope.domains);
	const entailed = await entailedMembers(scope.reasoner, scope.store, scope.domains, scope.records, expression);
	if (entailed.members.length > 0) return claimResult(entailment, VERDICT.proved, `the witness is ${entailed.members.map(addressText).join(", ")}`, countedMembers(entailed));
	return claimResult(entailment, VERDICT.unknown, `the records don't entail a named individual as a member, so ${UNDETERMINED}.${truncationOf(entailed)} ${UNKNOWN_REMEDY}`);
}
