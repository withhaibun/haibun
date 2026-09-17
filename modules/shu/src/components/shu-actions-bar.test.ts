// @vitest-environment jsdom
/**
 * The actions bar reads the page's state wherever it is placed: the context a view states, the strip's panes and the
 * pane the reader is on, and a step a view chooses. It is not told them by the app through its place in the page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Access } from "@haibun/core/lib/resources.js";

// The registry answers without a server, with one type to search, and the bar has no extensions to load.
vi.mock("../rpc-registry.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getAvailableSteps: () => Promise.resolve([]),
	getAvailableDomains: () => Promise.resolve({}),
	buildDomainOptions: () => [{ key: "Email", queryLabel: "Email", description: "", stepperName: "", selectable: true, group: "declared" }],
	isOffline: () => true,
}));
vi.mock("../quads-snapshot.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), selectValuesFor: () => Promise.resolve({}) }));
vi.mock("../rels-cache.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getActionBarChatExtensionTags: () => [],
	whenSiteMetadataReady: () => Promise.resolve({ ui: {} }),
}));

// jsdom lays nothing out, so the bar's footprint has nothing to observe.
globalThis.ResizeObserver ??= class {
	observe(): void {
		/* nothing resizes without layout */
	}
	unobserve(): void {
		/* nothing is observed */
	}
	disconnect(): void {
		/* nothing is observed */
	}
} as unknown as typeof ResizeObserver;

const { ShuActionsBar } = await import("./shu-actions-bar.js");
const { ShuBreadcrumb } = await import("./shu-breadcrumb.js");
const { SHU_TAG } = await import("../consts.js");
if (!customElements.get(SHU_TAG.ACTIONS_BAR)) customElements.define(SHU_TAG.ACTIONS_BAR, ShuActionsBar);
if (!customElements.get("shu-breadcrumb")) customElements.define("shu-breadcrumb", ShuBreadcrumb);
const { activePane, pageContext, stripPanes } = await import("../signals.js");
const { aType } = await import("../schemas.js");
const { SHU_EVENT } = await import("../consts.js");
const { setupShuTest } = await import("../test-setup.js");

type TBar = HTMLElement & { updateComplete: Promise<unknown>; state: { mode: string; askExpanded: boolean } };
type TTrail = { state: { queryLabel: string; columns: string[]; activeIndex: number } };

async function mountBar(): Promise<TBar> {
	const bar = new ShuActionsBar() as unknown as TBar;
	document.body.appendChild(bar);
	await bar.updateComplete;
	return bar;
}

/** What the bar's breadcrumb names, or a failure where the bar renders none. */
function trailOf(bar: TBar): TTrail["state"] {
	const breadcrumb = bar.shadowRoot?.querySelector("shu-breadcrumb");
	if (!breadcrumb) throw new Error("the bar doesn't render a breadcrumb");
	return (breadcrumb as unknown as TTrail).state;
}

describe("the actions bar reads the page's state", () => {
	let teardown: () => void;
	beforeEach(() => {
		teardown = setupShuTest().teardown;
		document.body.innerHTML = "";
		pageContext.set(null);
		stripPanes.set([]);
		activePane.set(null);
	});
	afterEach(() => teardown());

	it("describes the context a view stated before the bar connected", async () => {
		pageContext.set({ patterns: [aType("Email")], accessLevel: Access.private });
		const bar = await mountBar();
		expect(trailOf(bar).queryLabel, "the search names the stated type").toContain("Email");
	});

	it("names the strip's panes and the pane the reader is on in its breadcrumb", async () => {
		const bar = await mountBar();
		stripPanes.set([
			{ key: "query", label: "", query: true },
			{ key: "cmt-1", label: "Comment", query: false },
			{ key: "cmt-2", label: "Reply", query: false },
		]);
		activePane.set("cmt-2");
		await bar.updateComplete;
		expect(trailOf(bar).columns, "the breadcrumb names each column the strip holds after the query").toEqual(["Comment", "Reply"]);
		expect(trailOf(bar).activeIndex, "and the one the reader is on, counted from the query").toBe(2);
	});

	it("opens a step a view chooses, from wherever the view is in the page", async () => {
		const bar = await mountBar();
		const elsewhere = document.createElement("div");
		document.body.appendChild(elsewhere);
		elsewhere.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method: "GraphStepper-graphQuery" }, bubbles: true, composed: true }));
		await bar.updateComplete;
		expect(bar.state.mode, "the bar opens in step mode").toBe("step");
		expect(bar.state.askExpanded, "open").toBe(true);
	});
});
