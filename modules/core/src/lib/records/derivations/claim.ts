/**
 * Derives what a claim checks from the claim its line states: its reasoning task, its axiom in OWL 2 functional syntax and in
 * Manchester syntax where a frame states it, and the entailment in DL notation; and the result of a claim from how its check
 * ended, which its step returns and its record states.
 */
import { VERDICT, type TActionResult } from "../../domains/protocol.js";
import { actionNotOK, actionOKWithProducts, actionUnknown } from "../../domains/util.js";
import { DL_SYMBOL, FRAME_KIND } from "../domains/axioms.js";
import { manchesterOf, type TClassExpression } from "../domains/class-expression.js";
import { CLAIM_VERDICT, ClaimProductsSchema, REASONING_TASK, type TClaimOutcome, type TClaimVerdict, type TEntailment } from "../domains/claim.js";
import { BETWEEN_AXIOMS, manchesterName } from "./axioms.js";
import { dlOf, functionalOf } from "./class-expression.js";

/** A claim as its line states it: an individual's membership of a class expression, the subsumption of one class expression by
 *  another, the existence of a member of a class expression, or a statement a feature's contracts entail over a fresh individual
 *  of each declared domain. */
export type TClaim =
	| { individual: string; type: TClassExpression }
	| { sub: TClassExpression; sup: TClassExpression }
	| { some: TClassExpression }
	| { feature: string; claim: string; over: readonly string[] };

/** The knowledge a claim is checked against: the ontology and the records the reasoner read. */
const KNOWLEDGE = "K";
/** The named individual a retrieval's entailment ranges over. */
const RETRIEVED = "a";

/** Why a claim is unknown: K doesn't entail its axiom or the axiom's contradiction. */
export const UNDETERMINED = "K doesn't entail the axiom and doesn't contradict it, and unknown isn't false in the open world";

const entailed = (axiom: string): string => `${KNOWLEDGE} ${DL_SYMBOL.entails} ${axiom}`;

/** Returns what a claim checks: its reasoning task, its axiom in OWL 2 functional syntax and in Manchester syntax where a frame
 *  states it, the entailment K ⊨ axiom, and the entailment in DL notation. A subsumption of an expression that isn't a named
 *  class doesn't have a Manchester frame, and a retrieval doesn't check an axiom. */
export function entailmentOf(claim: TClaim): TEntailment {
	if ("individual" in claim) {
		const [individual, type] = [manchesterName(claim.individual), functionalOf(claim.type)];
		const functional = `ClassAssertion(${type} ${individual})`;
		return {
			task: REASONING_TASK.instance,
			functional,
			manchester: `${FRAME_KIND.individual}: ${individual} Types: ${manchesterOf(claim.type)}`,
			entails: entailed(functional),
			dl: entailed(`${individual} ${DL_SYMBOL.member} ${dlOf(claim.type)}`),
		};
	}
	if ("feature" in claim) {
		const entails = `${claim.feature} ${DL_SYMBOL.entails} ${claim.claim}`;
		return { task: REASONING_TASK.feature, entails, dl: claim.over.length === 0 ? entails : `${DL_SYMBOL.all}${claim.over.join(", ")}. ${entails}` };
	}
	if ("sub" in claim) {
		const functional = `SubClassOf(${functionalOf(claim.sub)} ${functionalOf(claim.sup)})`;
		const frame = "named" in claim.sub ? { manchester: `${FRAME_KIND.class}: ${manchesterName(claim.sub.named)} SubClassOf: ${manchesterOf(claim.sup)}` } : {};
		return { task: REASONING_TASK.subsumption, functional, ...frame, entails: entailed(functional), dl: entailed(`${dlOf(claim.sub)} ${DL_SYMBOL.subsumedBy} ${dlOf(claim.sup)}`) };
	}
	return {
		task: REASONING_TASK.retrieval,
		entails: `${DL_SYMBOL.some}${RETRIEVED}. ${entailed(`ClassAssertion(${functionalOf(claim.some)} ${RETRIEVED})`)}`,
		dl: `${DL_SYMBOL.some}${RETRIEVED}. ${entailed(`${RETRIEVED} ${DL_SYMBOL.member} ${dlOf(claim.some)}`)}`,
	};
}

/** A claim's result as text: its task, the entailment, its verdict, and its proof or why it doesn't hold. */
export const claimText = ({ task, entails, verdict, proof }: TClaimOutcome): string => [task, entails, CLAIM_VERDICT[verdict], proof].join(BETWEEN_AXIOMS);

/** Returns what a claim's step returns from how its check ended: it passes where the claim holds, and otherwise fails with its text as
 *  the reason, unknown or refuted. Its products hold how it ended beside `products`. */
export function claimResult(entailment: TEntailment, verdict: TClaimVerdict, proof: string, products?: Record<string, unknown>): TActionResult {
	const claim: TClaimOutcome = { ...entailment, verdict, proof };
	const held = { ...products, claim };
	if (verdict === VERDICT.proved) return actionOKWithProducts(held);
	return { ...(verdict === VERDICT.unknown ? actionUnknown(claimText(claim)) : actionNotOK(claimText(claim))), products: held };
}

/** The entailment a step's record states: its claim's result as text, where its products hold a claim's outcome. */
export function entailmentRecorded(products: Record<string, unknown> | undefined): { entailment?: string } {
	const claimed = ClaimProductsSchema.safeParse(products).data;
	return claimed === undefined ? {} : { entailment: claimText(claimed.claim) };
}
