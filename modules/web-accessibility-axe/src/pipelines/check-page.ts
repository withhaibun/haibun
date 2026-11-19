/**
 * An accessibility check of a page: axe's results read through the axe port, each rule's result recorded as an EARL
 * assertion the step made, and the page's serious and moderate violations evaluated against the counts accepted.
 */
import type { Page } from "playwright";
import { axeAssertions, evalSeverity, type TSeverity } from "../derivations/axe-earl.js";
import { axeReportHtml } from "../derivations/report.js";
import type { TAxe, TEarlPorts } from "../ports.js";
import { writeEarlAssertions } from "@haibun/core/lib/records/pipelines/earl-assertions.js";

/** A check's outcome: the page's violations against the counts accepted, and the report a reviewer reads. */
type TPageCheck = { evaluation: ReturnType<typeof evalSeverity>; report: string };

/** Check `page` with axe, record each rule's result as an assertion the step whose record is `step` made, and evaluate the
 *  page's violations against `accepted`. */
export async function checkPage(ports: TEarlPorts & { axe: TAxe }, page: Page, accepted: TSeverity, step: string): Promise<TPageCheck> {
	const results = await ports.axe.results(page);
	await writeEarlAssertions(ports.store, axeAssertions(results, step));
	return { evaluation: evalSeverity(results, accepted), report: axeReportHtml(results) };
}
