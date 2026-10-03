/**
 * An accessibility check's report as a page a reviewer reads: one static, self-contained HTML document, which holds no
 * script and loads nothing, so it reads the same offline and in a frame that runs no script. Every rule is a `<details>`
 * section, the violations open. Each states its impact, what it checks, axe's link to the rule's guidance, and each element
 * it found, by selector, by the element's HTML and by what axe states fails there. Everything the checked page supplied is
 * escaped, since the page is the one under test.
 */
import type { AxeResults, NodeResult, Result } from "axe-core";
import { esc } from "@haibun/core/lib/document-content.js";

/** The outcomes axe states, in the order a reviewer reads them, and whether each opens by default. */
const OUTCOMES = [
	{ key: "violations", title: "Violations", open: true },
	{ key: "incomplete", title: "Needs review", open: false },
	{ key: "passes", title: "Passes", open: false },
	{ key: "inapplicable", title: "Inapplicable", open: false },
] as const satisfies ReadonlyArray<{ key: keyof Pick<AxeResults, "violations" | "incomplete" | "passes" | "inapplicable">; title: string; open: boolean }>;

const STYLE = `body { font-family: system-ui, sans-serif; margin: 1.5rem; line-height: 1.4; }
summary { cursor: pointer; font-weight: 600; }
details { margin: 0.5rem 0; }
details details { margin-left: 1.25rem; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f4f4f4; padding: 0.5rem; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 0.25rem 0.5rem; text-align: left; }`;

/** One element a rule found: its selector, its HTML and what fails there. */
const nodeHtml = (node: NodeResult): string =>
	`<li><code>${esc(node.target.join(" "))}</code><pre>${esc(node.html)}</pre>${node.failureSummary ? `<pre>${esc(node.failureSummary)}</pre>` : ""}</li>`;

/** One rule: its impact, what it checks, the link to its guidance and the elements it found. */
const ruleHtml = (rule: Result, open: boolean): string =>
	`<details${open ? " open" : ""}><summary>${rule.impact ? `${esc(rule.impact)}: ` : ""}${esc(rule.help)} (${esc(rule.id)}, ${rule.nodes.length})</summary>
<p>${esc(rule.description)} <a href="${esc(rule.helpUrl)}" target="_blank" rel="noopener noreferrer">Guidance</a></p>
<ul>${rule.nodes.map(nodeHtml).join("")}</ul></details>`;

/** The report of a check of one page, as a self-contained HTML document. */
export function axeReportHtml(results: AxeResults): string {
	const counts = OUTCOMES.map(({ key, title }) => `<tr><th>${title}</th><td>${results[key].length}</td></tr>`).join("");
	const sections = OUTCOMES.map(
		({ key, title, open }) =>
			`<details${open ? " open" : ""}><summary>${title} (${results[key].length})</summary>${results[key].map((rule) => ruleHtml(rule, open)).join("")}</details>`,
	).join("\n");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Accessibility of ${esc(results.url)}</title><style>${STYLE}</style></head>
<body><h1>Accessibility of <a href="${esc(results.url)}" target="_blank" rel="noopener noreferrer">${esc(results.url)}</a></h1>
<p>Checked ${esc(results.timestamp)} with axe-core ${esc(results.testEngine.version)}.</p>
<table>${counts}</table>
${sections}
</body></html>`;
}
