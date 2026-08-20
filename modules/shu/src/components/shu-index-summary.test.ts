// @vitest-environment jsdom
/**
 * What the index says about itself once it is collapsed to a spine.
 *
 * The spine has room for one line, and the line has to be worth the room: which search produced what is behind the
 * strip, and how much of it there is. The context it reads is the one the index already publishes, and other columns
 * publish that context too, so the test that matters is that another column's search is not read as the index's.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ShuIndexSummary } from "./shu-index-summary.js";
import { SHU_EVENT, SPINE_SLOT } from "../consts.js";
import { viewQuery } from "../view-query.js";
import { ShuColumnPane } from "./shu-column-pane.js";
import { installTestMediaQueries } from "../test-setup.js";

/** The search the index is showing, which is shared state rather than anything the summary is handed. */
function searching(hash: string): void {
	viewQuery.hydrate(hash);
}

/** The index reporting how many it found, from where the index actually sits: outside the pane, not under it. */
function publish(from: string, detail: Record<string, unknown>): void {
	const source = document.createElement(from);
	document.body.appendChild(source);
	source.dispatchEvent(new CustomEvent(SHU_EVENT.CONTEXT_CHANGE, { detail, bubbles: true, composed: true }));
	source.remove();
}

beforeAll(() => {
	installTestMediaQueries(); // the pane asks the viewport whether it is narrow; jsdom answers no such question
	if (!customElements.get("shu-index-summary")) customElements.define("shu-index-summary", ShuIndexSummary);
	if (!customElements.get("shu-column-pane")) customElements.define("shu-column-pane", ShuColumnPane);
});

describe("the index's spine summary", () => {
	let summary: ShuIndexSummary;

	beforeEach(async () => {
		document.body.innerHTML = "";
		searching("#?"); // the shared query outlives one test, so each starts from no search
		summary = document.createElement("shu-index-summary") as ShuIndexSummary;
		document.body.appendChild(summary);
		await summary.updateComplete;
	});

	// What a reader would see, and only that. jsdom has no adoptedStyleSheets, so lit puts the component's CSS in a
	// <style> inside the shadow root, and lit's own bookkeeping sits there as comment markers; reading the root's text
	// whole would read both, and every assertion below would be about the stylesheet.
	const shown = () =>
		Array.from(summary.shadowRoot?.childNodes ?? [])
			.filter((node) => (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName !== "STYLE") || node.nodeType === Node.TEXT_NODE)
			.map((node) => node.textContent ?? "")
			.join("");

	it("says nothing before the index has published anything, rather than a count of nothing", () => {
		expect(shown().trim()).toBe("");
	});

	it("names the search and how many it found", async () => {
		searching("#?label=Person&q=smith");
		publish("shu-graph-query", { total: 42 });
		await summary.updateComplete;
		expect(shown()).toContain("Person");
		expect(shown(), "the text that was searched for").toContain("smith");
		expect(shown(), "and how much is behind the strip").toContain("42");
	});

	it("does not take another column's count as the index's", async () => {
		searching("#?label=Person");
		publish("shu-graph-query", { total: 42 });
		await summary.updateComplete;
		publish("shu-entity-column", { total: 7 });
		await summary.updateComplete;
		expect(shown(), "an entity column reports on its own subject, not on the index").not.toContain("7");
		expect(shown()).toContain("42");
	});

	it("follows the search itself, which it reads rather than being told", async () => {
		searching("#?label=Person");
		await summary.updateComplete;
		expect(shown()).toContain("Person");
		searching("#?label=Invoice");
		await summary.updateComplete;
		expect(shown()).toContain("Invoice");
		expect(shown()).not.toContain("Person");
	});
});

describe("a spine view while its column is open", () => {
	// Attached but unslotted is how a spine view keeps hearing what it needs, and it must not cost what being shown
	// costs: nothing it renders can be seen, so it renders nothing until the spine slot takes it.
	it("hears the index without rendering, and is current the moment the column collapses", async () => {
		document.body.innerHTML = "";
		const pane = document.createElement("shu-column-pane") as ShuColumnPane;
		pane.setAttribute("label", "Index");
		pane.dataset.columnKey = "query";
		const summary = document.createElement("shu-index-summary") as ShuIndexSummary;
		summary.setAttribute("slot", SPINE_SLOT);
		pane.appendChild(document.createElement("div"));
		pane.appendChild(summary);
		document.body.appendChild(pane);
		await pane.updateComplete;

		searching("#?label=Person");
		publish("shu-graph-query", { total: 42 });
		await summary.updateComplete;
		expect(summary.shadowRoot?.querySelector(".count"), "open, nothing shows the spine, so nothing is rendered for it").toBeNull();

		pane.setMinimized(true);
		await pane.updateComplete;
		await summary.updateComplete;
		expect(summary.shadowRoot?.querySelector(".count")?.textContent, "collapsed, it shows what it heard while it was open").toBe("42");
	});
});
