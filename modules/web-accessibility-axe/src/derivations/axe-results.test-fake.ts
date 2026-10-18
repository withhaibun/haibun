/** axe-core results as a check of a page returns them, for tests of what is made from them. */
import type { AxeResults, Result } from "axe-core";

/** An element a rule found: where it is, its HTML, and what axe states fails there, where it states one. */
type TFoundNode = { target: string; html: string; failureSummary?: string };

/** A rule axe applied, with the element each of `nodes` names. Its guidance is addressed as axe addresses it. */
export const axeRule = (id: string, impact: Result["impact"], tags: string[], nodes: TFoundNode[]): Result => ({
	id,
	impact,
	tags,
	description: `${id} description`,
	help: `${id} help`,
	helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}?application=axeAPI`,
	nodes: nodes.map(({ target, html, failureSummary }) => ({ html, target: [target], failureSummary, impact, any: [], all: [], none: [] })),
});

/** The results of a check of the page at `url`, with the rules of each outcome. */
export const axeResults = (url: string, outcomes: Pick<AxeResults, "violations" | "incomplete" | "passes" | "inapplicable">): AxeResults => ({
	toolOptions: {},
	testEngine: { name: "axe-core", version: "4.13.0" },
	testRunner: { name: "axe" },
	testEnvironment: { userAgent: "test", windowWidth: 800, windowHeight: 600 },
	url,
	timestamp: "2026-10-03T00:00:00.000Z",
	...outcomes,
});
