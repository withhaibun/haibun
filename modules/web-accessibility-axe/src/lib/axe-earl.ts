/**
 * An axe check's results as EARL assertions: one for each rule axe applied, by the outcome axe states for it. axe states
 * a rule it couldn't decide as needing review, which EARL states as `cantTell`. axe lists a rule under each outcome its
 * elements had, so a rule that fails on one element and passes on another is in both lists. EARL states one result of a
 * test on a subject, so the rule's assertion states its most severe outcome, with the elements axe found it at. A rule
 * that doesn't apply to the page states nothing about it, so it is listed in the report and isn't recorded.
 */
import type { AxeResults, Result } from "axe-core";
import { isWebAddress } from "@haibun/core/lib/document-content.js";
import { EARL_MODE, EARL_OUTCOME, type TEarlAssertions } from "./earl.js";

/** Each list of rules axe states that is recorded, by the EARL outcome it is, the most severe first. */
const OUTCOME_OF = { violations: EARL_OUTCOME.failed, incomplete: EARL_OUTCOME.cantTell, passes: EARL_OUTCOME.passed } as const;

/** A rule's id as a test case: its guidance's address, which names the rule at the version of axe that applied it. */
const testCaseId = (helpUrl: string): string => {
	const url = new URL(helpUrl);
	url.search = "";
	return url.href;
};

/** An address the checked page supplied, as a record's link where it is a web address: an address of another scheme can run script. */
const webAddress = (address: string): { url?: string } => (isWebAddress(address) ? { url: address } : {});

/** One rule's result: where each element it found is, and what axe states fails there. */
const resultOf = (rule: Result, outcome: (typeof OUTCOME_OF)[keyof typeof OUTCOME_OF]) => {
	const summaries = [...new Set(rule.nodes.flatMap((node) => (node.failureSummary ? [node.failureSummary] : [])))];
	const pointers = rule.nodes.map((node) => node.target.join(" "));
	return {
		outcome,
		...(summaries.length ? { info: summaries.join("\n\n") } : {}),
		...(pointers.length ? { pointers } : {}),
		...(rule.impact ? { impact: rule.impact } : {}),
	};
};

/** The assertions an axe check of a page states, made by the step whose record is named `step`. */
export function axeAssertions(results: AxeResults, step: string): TEarlAssertions {
	const { version } = results.testEngine;
	return {
		assertor: { id: `https://github.com/dequelabs/axe-core/releases/tag/v${version}`, name: `axe-core ${version}` },
		subject: { id: results.url, ...webAddress(results.url) },
		mode: EARL_MODE.automatic,
		step,
		results: (Object.keys(OUTCOME_OF) as (keyof typeof OUTCOME_OF)[])
			.flatMap((list) => results[list].map((rule) => ({ rule, outcome: OUTCOME_OF[list] })))
			.filter(({ rule }, at, all) => all.findIndex((other) => other.rule.id === rule.id) === at)
			.map(({ rule, outcome }) => ({
				test: { id: testCaseId(rule.helpUrl), name: rule.help, description: rule.description, ...webAddress(rule.helpUrl), tags: rule.tags },
				result: resultOf(rule, outcome),
			})),
	};
}
