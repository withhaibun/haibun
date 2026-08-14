// A serialized report inlines a component's JS only when that component's view is in the final report (the columns
// shown at endFeature). A heavy external-component bundle is embedded when its view is shown, and omitted otherwise —
// keeping ordinary reports small while never dropping a component the report actually displays.
import { describe, it, expect } from "vitest";
import { inlineScriptsForView } from "./monitor-stepper.js";

const VIEWER_JS = "/* heavy external viewer bundle */ customElements.define('x-heavy-viewer', class extends HTMLElement{});";
const domains = {
	"x-heavy-viewer": { ui: { component: "x-heavy-viewer", js: "/assets/x-heavy-viewer.js", jsContent: VIEWER_JS } },
	"x-status-badge": { ui: { component: "x-status-badge", js: "/assets/x-status-badge.js", jsContent: "/* badge */" } },
	"graph-query": { schema: {} }, // no ui
	"shu-polymorphic-graph-view": { ui: { component: "shu-polymorphic-graph-view" } }, // built into the main bundle: no jsContent
};

describe("report inlines a component's JS only when its view is in the final report", () => {
	it("INCLUDES a heavy external component's bundle when its view is a final-view column", () => {
		const scripts = inlineScriptsForView(domains, new Set(["shu-polymorphic-graph-view", "x-heavy-viewer"]));
		expect(scripts).toContain(VIEWER_JS);
	});

	it("OMITS the heavy bundle when its view is not shown", () => {
		const scripts = inlineScriptsForView(domains, new Set(["shu-polymorphic-graph-view", "shu-document-column"]));
		expect(scripts).not.toContain(VIEWER_JS);
		expect(scripts).toEqual([]); // none of the shown components carry jsContent
	});

	it("includes only the in-view components that carry jsContent (skips main-bundle and ui-less domains)", () => {
		const scripts = inlineScriptsForView(domains, new Set(["x-heavy-viewer", "x-status-badge", "shu-polymorphic-graph-view", "graph-query"]));
		expect(scripts.sort()).toEqual([VIEWER_JS, "/* badge */"].sort());
	});
});
