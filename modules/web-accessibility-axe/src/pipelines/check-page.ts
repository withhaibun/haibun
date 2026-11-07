/**
 * An accessibility check of a page: axe's results read through the axe port, each rule's result recorded as an EARL
 * assertion the step made, and the page's serious and moderate violations evaluated against the counts accepted.
 */
import type { Page } from "playwright";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/domains/resources.js";
import { EDGE_TARGET, type TUnitEdge } from "@haibun/core/lib/records/domains/unit.js";
import { EARL_ASSERTION_EDGE, EARL_LABEL, type TEarlAssertions } from "../domains/earl.js";
import { axeAssertions, evalSeverity, type TSeverity } from "../derivations/axe-earl.js";
import { axeReportHtml } from "../derivations/report.js";
import type { TAxe, TEarlPorts } from "../ports.js";

/** Record what an assertor states of a subject: each result as an assertion the step made, linked to the assertor, the
 *  subject, the test case and the result. Returns the assertions' ids. */
export async function writeEarlAssertions({ store, clock }: TEarlPorts, { assertor, subject, mode, step, results }: TEarlAssertions): Promise<string[]> {
	const generatedAtTime = new Date(clock.now()).toISOString();
	await Promise.all([
		store.write({ label: EARL_LABEL.assertor, record: { ...assertor, generatedAtTime } }),
		store.write({ label: EARL_LABEL.testSubject, record: { ...subject, generatedAtTime } }),
	]);
	return await Promise.all(
		results.map(async ({ test, result }) => {
			const id = `${step} ${test.id}`;
			const resultId = `${id} result`;
			// The assertion owns its result, so it is written with it in one unit, after the test case it names.
			await store.write({ label: EARL_LABEL.testCase, record: { ...test, generatedAtTime } });
			const held = (rel: string, label: string, to: string): TUnitEdge => ({ rel, label, id: to, target: EDGE_TARGET.held });
			const edges = [
				held(EARL_ASSERTION_EDGE.assertedBy, EARL_LABEL.assertor, assertor.id),
				held(EARL_ASSERTION_EDGE.subject, EARL_LABEL.testSubject, subject.id),
				held(EARL_ASSERTION_EDGE.test, EARL_LABEL.testCase, test.id),
				held(EARL_ASSERTION_EDGE.result, EARL_LABEL.testResult, resultId),
				{ rel: EARL_ASSERTION_EDGE.wasGeneratedBy, label: SEQ_PATH_LABEL, id: step, target: EDGE_TARGET.reference },
			];
			const owned = { label: EARL_LABEL.testResult, record: { ...result, id: resultId, generatedAtTime } };
			await store.write({ label: EARL_LABEL.assertion, record: { id, mode, generatedAtTime }, owns: [owned], edges });
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
