// @vitest-environment jsdom
/**
 * The actions bar reads the page's state wherever it is placed: the context a view states and a step a view chooses. It
 * is not told them by the app through its place in the page. It is a pane's view, so it opens its pane for a chosen
 * step, and its scope of the active record follows its pane. What its search describes goes to the page strip.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Access } from "@haibun/core/lib/resources.js";

// The registry answers without a server, with one type to search, and the bar has no extensions to load.
vi.mock("../rpc-registry.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	// The run offers the step an ask runs, so a chosen Ask mode renders.
	getAvailableSteps: () =>
		Promise.resolve([{ method: "LlmStepper-chatWithContext", stepperName: "LlmStepper", stepName: "chatWithContext", pattern: "ask {prompt}", description: "", paramDomains: {} }]),
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

const { provideLayout } = await import("../test/jsdom-layout.js");
provideLayout();

const { ShuActionsBar } = await import("./shu-actions-bar.js");
const { SHU_ATTR, SHU_EVENT, SHU_TAG } = await import("../consts.js");
if (!customElements.get(SHU_TAG.ACTIONS_BAR)) customElements.define(SHU_TAG.ACTIONS_BAR, ShuActionsBar);
const { ShuColumnPane } = await import("./shu-column-pane.js");
if (!customElements.get(SHU_TAG.COLUMN_PANE)) customElements.define(SHU_TAG.COLUMN_PANE, ShuColumnPane);
const { INITIAL_SUBJECT, SCOPE, currentSubjectState } = await import("../current-subject.js");
const { pageContext, pageTrail } = await import("../signals.js");
const { aType } = await import("../schemas.js");
const { setupShuTest } = await import("../test-setup.js");

type TBar = HTMLElement & { updateComplete: Promise<unknown>; state: { mode: string }; setState: (partial: { mode: string }) => void };
type TPane = InstanceType<typeof ShuColumnPane>;

/** A column's collapse reaches its view through an observer of the pane, which reports after the change. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountBar(): Promise<TBar> {
	const bar = new ShuActionsBar() as unknown as TBar;
	document.body.appendChild(bar);
	await bar.updateComplete;
	return bar;
}

/** The bar as the view of a docked pane, closed to its strip, as the page holds it. */
async function mountDockedBar(): Promise<{ pane: TPane; bar: TBar }> {
	const pane = new ShuColumnPane();
	pane.setAttribute("label", "Actions");
	pane.dataset.columnKey = SHU_TAG.ACTIONS_BAR;
	pane.setDocked(true);
	document.body.appendChild(pane);
	const bar = new ShuActionsBar() as unknown as TBar;
	pane.appendChild(bar);
	await pane.updateComplete;
	await bar.updateComplete;
	return { pane, bar };
}

describe("the actions bar reads the page's state", () => {
	let teardown: () => void;
	beforeEach(() => {
		teardown = setupShuTest().teardown;
		document.body.innerHTML = "";
		pageContext.set(null);
		pageTrail.set("All");
		currentSubjectState.set(INITIAL_SUBJECT);
	});
	// A pane updates while it is in the page, and the page it leaves updates nothing: every case ends with the panes it
	// mounted removed, so none of them renders while the test environment closes.
	afterEach(() => {
		document.body.innerHTML = "";
		teardown();
	});

	it("describes to the page strip the context a view stated before the bar connected, and settles its type once the types are read", async () => {
		pageContext.set({ patterns: [aType("Email")], accessLevel: Access.private, label: "Email" });
		await mountBar();
		expect(pageTrail.get(), "the search names the stated type").toContain("Email");
	});

	it("opens its pane for a step a view chooses, from wherever the view is in the page", async () => {
		const { pane, bar } = await mountDockedBar();
		expect(pane.isCollapsed, "the docked pane stands at its strip").toBe(true);
		const elsewhere = document.createElement("div");
		document.body.appendChild(elsewhere);
		elsewhere.dispatchEvent(new CustomEvent(SHU_EVENT.STEP_CHOOSE, { detail: { method: "GraphStepper-graphQuery" }, bubbles: true, composed: true }));
		await bar.updateComplete;
		expect(bar.state.mode, "the bar is in step mode").toBe("step");
		expect(pane.isCollapsed, "and its pane is open").toBe(false);
	});

	it("shows the search's filters where its pane's settings control does, above the transcript, and the search line without them", async () => {
		const { pane, bar } = await mountDockedBar();
		pane.open();
		await settle();
		await bar.updateComplete;
		expect(bar.shadowRoot?.querySelector(".text-search"), "the text to search for stands in the line").not.toBeNull();
		expect(bar.shadowRoot?.querySelector(".search-settings"), "and its filters wait on the pane's control").toBeNull();
		bar.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		await bar.updateComplete;
		const regions = Array.from(bar.shadowRoot?.querySelector(".actions-bar")?.children ?? []).map((c) => c.className.split(" ")[0] || c.tagName.toLowerCase());
		expect(regions, "the filters stand above the transcript, and the search line below it").toEqual(["filter-bar", SHU_TAG.ACTIVITY_HISTORY, "filter-bar"]);
		expect(bar.shadowRoot?.querySelector(".add-filter"), "the control that adds a condition").not.toBeNull();
	});

	it("holds the transcript inside the ask, with the settings its pane's control states, so the settings stand above it", async () => {
		const { pane, bar } = await mountDockedBar();
		pane.open();
		bar.setState({ mode: "ask" });
		await settle();
		await bar.updateComplete;
		const ask = bar.shadowRoot?.querySelector(SHU_TAG.KIHAN_CHAT) as HTMLElement | null;
		expect(ask, "the ask is the body of the bar").not.toBeNull();
		expect(ask?.querySelector(SHU_TAG.ACTIVITY_HISTORY), "and holds the transcript").not.toBeNull();
		expect(ask?.hasAttribute(SHU_ATTR.SHOW_CONTROLS), "whose settings are hidden until the pane's control shows them").toBe(false);
		bar.setAttribute(SHU_ATTR.SHOW_CONTROLS, "");
		await bar.updateComplete;
		expect(ask?.hasAttribute(SHU_ATTR.SHOW_CONTROLS)).toBe(true);
	});

	it("opens its scope of the active record with its pane, closes it with its pane, and closes it when the bar goes", async () => {
		const { pane, bar } = await mountDockedBar();
		await settle();
		expect(currentSubjectState.get().open).not.toContain(SCOPE.actionsBar);
		pane.open();
		await settle();
		await bar.updateComplete;
		expect(currentSubjectState.get().open).toContain(SCOPE.actionsBar);
		pane.close();
		await settle();
		await bar.updateComplete;
		expect(currentSubjectState.get().open, "a pane closed to its strip closes the scope").not.toContain(SCOPE.actionsBar);
		pane.open();
		await settle();
		await bar.updateComplete;
		bar.remove();
		expect(currentSubjectState.get().open, "a bar removed from the page leaves its scope closed").not.toContain(SCOPE.actionsBar);
	});
});
