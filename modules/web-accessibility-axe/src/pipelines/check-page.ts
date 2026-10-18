/**
 * An accessibility check of a page: axe's results read through the axe port, each rule's result recorded as an EARL
 * assertion the step made, and the page's serious and moderate violations evaluated against the counts accepted.
 */
import type { Page } from "playwright";
import { SEQ_PATH_LABEL, writeEdge, writeReferenceEdge } from "@haibun/core/lib/resources.js";
import { EARL_ASSERTION_EDGE, EARL_LABEL, type TEarlAssertions } from "../domains/earl.js";
import { axeAssertions, evalSeverity, type TSeverity } from "../derivations/axe-earl.js";
import { axeReportHtml } from "../derivations/report.js";
import type { TAxe, TEarlPorts } from "../ports.js";

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids. */
export async function writeEarlAssertions({ store, clock }: TEarlPorts, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
	const generatedAtTime = new Date(clock.now()).toISOString();
	await Promise.all([
		store.upsertIndividual(EARL_LABEL.assertor, { ...assertor, generatedAtTime }),
		store.upsertIndividual(EARL_LABEL.testSubject, { ...subject, generatedAtTime }),
	]);
	return await Promise.all(
		results.map(async ({ test, result }) => {
			const id = `${step} ${test.id}`;
			const resultId = `${id} result`;
			await Promise.all([
				store.upsertIndividual(EARL_LABEL.testCase, { ...test, generatedAtTime }),
				store.upsertIndividual(EARL_LABEL.testResult, { ...result, id: resultId, generatedAtTime }),
				store.upsertIndividual(EARL_LABEL.assertion, { id, mode, generatedAtTime }),
			]);
			const edge = (key: string, label: string, to: string) => writeEdge(store, EARL_LABEL.assertion, id, key, label, to);
			await Promise.all([
				edge(EARL_ASSERTION_EDGE.assertedBy, EARL_LABEL.assertor, assertor.id),
				edge(EARL_ASSERTION_EDGE.subject, EARL_LABEL.testSubject, subject.id),
				edge(EARL_ASSERTION_EDGE.test, EARL_LABEL.testCase, test.id),
				edge(EARL_ASSERTION_EDGE.result, EARL_LABEL.testResult, resultId),
				writeReferenceEdge(store, EARL_LABEL.assertion, id, EARL_ASSERTION_EDGE.wasGeneratedBy, SEQ_PATH_LABEL, step),
			]);
			return id;
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
