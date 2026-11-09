/**
 * An accessibility check of a page: axe's results read through the axe port, each rule's result recorded as an EARL
 * assertion the step made, and the page's serious and moderate violations evaluated against the counts accepted.
 */
import type { Page } from "playwright";
import { EARL_ASSERTION_EDGE, EARL_LABEL, type TEarlAssertions } from "../domains/earl.js";
import { axeAssertions, evalSeverity, type TSeverity } from "../derivations/axe-earl.js";
import { axeReportHtml } from "../derivations/report.js";
import type { TAxe, TEarlPorts } from "../ports.js";
import { referenceTo } from "@haibun/core/lib/records/domains/unit.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids. */
export async function writeEarlAssertions({ store }: TEarlPorts, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
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

/** A check's outcome: the page's violations against the counts accepted, and the report a reviewer reads. */
export type TPageCheck = { evaluation: ReturnType<typeof evalSeverity>; report: string };

/** Check `page` with axe, record each rule's result as an assertion the step whose record is `step` made, and evaluate the
 *  page's violations against `accepted`. */
export async function checkPage(ports: TEarlPorts & { axe: TAxe }, page: Page, accepted: TSeverity, step: string): Promise<TPageCheck> {
	const results = await ports.axe.results(page);
	await writeEarlAssertions(ports, axeAssertions(results, step));
	return { evaluation: evalSeverity(results, accepted), report: axeReportHtml(results) };
}
