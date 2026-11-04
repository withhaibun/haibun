/**
 * A claim's standard meaning: the OWL 2 reasoning task it is, the axiom it checks, in OWL 2 functional syntax and in Manchester
 * syntax where a frame states it, and the entailment in DL notation. A claim holds exactly where its axiom is entailed
 * (K ⊨ axiom), is refuted where the axiom contradicts the knowledge, and is unknown otherwise. `individual X is a E` checks
 * ClassAssertion(E X), an instance check; `every E1 is a E2` checks SubClassOf(E1 E2), a subsumption check; and `some E`
 * doesn't check an axiom: it retrieves the named individuals entailed to be an E, and holds where there is one.
 */
import { z } from "zod";
import { VERDICT } from "../../domains/protocol.js";

/** The OWL 2 reasoning task of each claim. */
export const REASONING_TASK = { instance: "instance check", subsumption: "subsumption check", retrieval: "instance retrieval" } as const;

/** A claim's verdict as its result states it, by the verdict of its proof. A claim's proof doesn't end as a contradiction. */
export const CLAIM_VERDICT = { [VERDICT.proved]: "holds", [VERDICT.refuted]: "refuted", [VERDICT.unknown]: "unknown" } as const;
export type TClaimVerdict = keyof typeof CLAIM_VERDICT;

/** What a claim checks: its reasoning task, its axiom in OWL 2 functional syntax and in Manchester syntax where a frame states
 *  it, the entailment K ⊨ axiom, and the entailment in DL notation. A retrieval doesn't check an axiom. */
export const EntailmentSchema = z
	.object({ task: z.enum(REASONING_TASK), functional: z.string().optional(), manchester: z.string().optional(), entails: z.string(), dl: z.string() })
	.strict();
export type TEntailment = z.infer<typeof EntailmentSchema>;

/** How a claim ended: what it checks, its verdict, and the proof of a claim that holds or why one doesn't, with its witness
 *  where it names one. */
export const ClaimOutcomeSchema = EntailmentSchema.extend({ verdict: z.enum([VERDICT.proved, VERDICT.refuted, VERDICT.unknown]), proof: z.string() }).strict();
export type TClaimOutcome = z.infer<typeof ClaimOutcomeSchema>;

/** The products of a claim's step, which hold how it ended beside its own products. */
export const ClaimProductsSchema = z.object({ claim: ClaimOutcomeSchema });
