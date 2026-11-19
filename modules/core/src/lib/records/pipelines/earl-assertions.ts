/**
 * Records what an assertor states of a subject as EARL assertions (EARL 1.0, https://www.w3.org/TR/EARL10-Schema/): each result
 * an assertion the step made, linked to the assertor, the subject, the test case and the result.
 */
import { EARL_ASSERTION_EDGE, EARL_LABEL, type TEarlAssertions } from "../../domains/earl.js";
import { SEQ_PATH_LABEL } from "../../domains/resources.js";
import { referenceTo } from "../domains/unit.js";
import type { IQuadStore } from "../../steps/ports.js";

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids. */
export async function writeEarlAssertions(store: Pick<IQuadStore, "create" | "merge">, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
	await Promise.all([store.merge({ "@type": EARL_LABEL.assertor, ...assertor }), store.merge({ "@type": EARL_LABEL.testSubject, ...subject })]);
	return await Promise.all(
		results.map(async ({ test, result }) => {
			const id = `${step} ${test.id}`;
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
