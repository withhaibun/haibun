/**
 * Records what an assertor states of a subject as EARL assertions (EARL 1.0, https://www.w3.org/TR/EARL10-Schema/): each result
 * an assertion the step made, linked to the assertor, the subject, the test case and the result.
 */
import { EARL_ASSERTION_EDGE, EARL_LABEL, EARL_MODE, EARL_OUTCOME, type TEarlAssertions } from "../../domains/earl.js";
import { VERDICT } from "../../domains/protocol.js";
import type { TAssumedClaim, TClaimVerdict } from "../domains/claim.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { curieOf, referenceTo } from "../domains/unit.js";
import type { IQuadStore } from "../../steps/ports.js";

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids, each of the step, the subject and the test case. */
export async function writeEarlAssertions(store: Pick<IQuadStore, "create" | "merge">, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
	await Promise.all([store.merge({ "@type": EARL_LABEL.assertor, ...assertor }), store.merge({ "@type": EARL_LABEL.testSubject, ...subject })]);
	return await Promise.all(
		results.map(async ({ test, result }) => {
			// One assertion states one subject's result against one test case in one step.
			const id = `${step} ${subject.id} ${test.id}`;
			// The assertion owns its result, so it is written with it in one unit, after the test case it names.
			await store.merge({ "@type": EARL_LABEL.testCase, ...test });
			return await store.create({
				"@type": EARL_LABEL.assertion,
				id,
				mode,
				[EARL_ASSERTION_EDGE.assertedBy]: referenceTo(EARL_LABEL.assertor, assertor.id),
				[EARL_ASSERTION_EDGE.subject]: referenceTo(EARL_LABEL.testSubject, subject.id),
				[EARL_ASSERTION_EDGE.test]: referenceTo(EARL_LABEL.testCase, test.id),
				[EARL_ASSERTION_EDGE.result]: { ...result, id: `${id} result` },
				[EARL_ASSERTION_EDGE.wasGeneratedBy]: referenceTo(SEQ_PATH_LABEL, step),
			});
		}),
	);
}

/** The assertor of the claims about the records a step whose products are assumed wrote: actuality's reasoner. */
const REASONER = { id: "urn:haibun:reasoner", name: "haibun's reasoner, under the rules of OWL 2 RL" };

/** The EARL outcome of each claim's verdict. */
const OUTCOME_OF = { [VERDICT.proved]: EARL_OUTCOME.passed, [VERDICT.refuted]: EARL_OUTCOME.failed, [VERDICT.unknown]: EARL_OUTCOME.cantTell } as const satisfies Record<
	TClaimVerdict,
	string
>;

/** Returns the claims about the records a step wrote as EARL assertions the step made, one set for each record: the record by its
 *  typed CURIE as the subject, each claim's test as its test case, its verdict as the outcome and its proof as what the result
 *  states. */
export function claimAssertions(step: string, claims: readonly TAssumedClaim[]): TEarlAssertions[] {
	return [...Map.groupBy(claims, ({ subject }) => curieOf(subject))].map(([subject, held]) => ({
		assertor: REASONER,
		subject: { id: subject },
		mode: EARL_MODE.automatic,
		step,
		results: held.map(({ test, verdict, proof }) => ({
			test: { id: `urn:haibun:test:${encodeURIComponent(test)}`, name: test },
			result: { outcome: OUTCOME_OF[verdict], info: proof },
		})),
	}));
}
