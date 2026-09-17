// @vitest-environment jsdom
/**
 * The page strip stands along the bottom of the page whatever is docked above it. It names the search and the columns in
 * its breadcrumb, says the page's status, opens, closes and pins the docked pane, and changes the read access level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Access } from "@haibun/core/lib/resources.js";

// The registry answers without a server, and the strip has no extensions to load.
vi.mock("../rpc-registry.js", async (actual) => ({ ...(await actual<Record<string, unknown>>()), isOffline: () => true }));
vi.mock("../rels-cache.js", async (actual) => ({
	...(await actual<Record<string, unknown>>()),
	getUiExtensionTags: () => [],
	whenSiteMetadataReady: () => Promise.resolve({ ui: {} }),
}));

const { provideLayout } = await import("../test/jsdom-layout.js");
provideLayout();

const { ShuPageStrip } = await import("./shu-page-strip.js");
const { ShuColumnPane } = await import("./shu-column-pane.js");
const { ShuBreadcrumb } = await import("./shu-breadcrumb.js");
const { ShuCombobox } = await import("./shu-combobox.js");
const { SHU_EVENT, SHU_TAG } = await import("../consts.js");
const { SHU_TEST_IDS } = await import("../test-ids.js");
for (const [tag, element] of [
	[SHU_TAG.PAGE_STRIP, ShuPageStrip],
	[SHU_TAG.COLUMN_PANE, ShuColumnPane],
	[SHU_TAG.BREADCRUMB, ShuBreadcrumb],
	[SHU_TAG.COMBOBOX, ShuCombobox],
] as const) {
	if (!customElements.get(tag)) customElements.define(tag, element);
}
const { activePane, dockedPane, pageContext, pageStatus, pageTrail, pageTypes, stripPanes } = await import("../signals.js");
const { setupShuTest } = await import("../test-setup.js");

type TStrip = InstanceType<typeof ShuPageStrip>;
type TPane = InstanceType<typeof ShuColumnPane>;
type TTrail = { state: { queryLabel: string; columns: string[]; activeIndex: number } };

const PREFIX = "app-";

async function mountStrip(): Promise<TStrip> {
	const strip = new ShuPageStrip();
	strip.setAttribute("testid-prefix", PREFIX);
	document.body.appendChild(strip);
	await strip.updateComplete;
	return strip;
}

/** A pane docked along the bottom of the page, closed to its strip. */
async function mountDockedPane(): Promise<TPane> {
	const pane = new ShuColumnPane();
	pane.setAttribute("label", "Actions");
	pane.dataset.columnKey = "actions";
	pane.setDocked(true);
	document.body.appendChild(pane);
	await pane.updateComplete;
	return pane;
}

const control = (strip: TStrip, testId: string) => strip.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`) as HTMLButtonElement;

/** Let the pane render and state itself as docked, then let the strip render what that states. */
async function settled(pane: TPane, strip: TStrip): Promise<void> {
	await pane.updateComplete;
	await strip.updateComplete;
}

function trailOf(strip: TStrip): TTrail["state"] {
	const breadcrumb = strip.shadowRoot?.querySelector(SHU_TAG.BREADCRUMB);
	if (!breadcrumb) throw new Error("the page strip doesn't render a breadcrumb");
	return (breadcrumb as unknown as TTrail).state;
}

describe("the page strip", () => {
	let teardown: () => void;
	beforeEach(() => {
		teardown = setupShuTest().teardown;
		document.body.innerHTML = "";
		pageContext.set(null);
		pageStatus.set("");
		pageTrail.set("All");
		stripPanes.set([]);
		activePane.set(null);
		dockedPane.set(null);
		pageTypes.set({ options: [], selected: "" });
	});
	afterEach(() => teardown());

	it("names the search, the strip's columns and the column the reader is on in its breadcrumb, and not a docked pane", async () => {
		const strip = await mountStrip();
		pageTrail.set("Email");
		stripPanes.set([
			{ key: "query", label: "", query: true, docked: false },
			{ key: "cmt-1", label: "Comment", query: false, docked: false },
			{ key: "actions", label: "Actions", query: false, docked: true },
			{ key: "cmt-2", label: "Reply", query: false, docked: false },
		]);
		activePane.set("cmt-2");
		await strip.updateComplete;
		expect(trailOf(strip).queryLabel).toBe("Email");
		expect(trailOf(strip).columns, "the breadcrumb names each column after the query").toEqual(["Comment", "Reply"]);
		expect(trailOf(strip).activeIndex, "and the one the reader is on, counted from the query").toBe(2);
	});

	it("offers the types the search states, beside what the search found, and states the one a reader chooses", async () => {
		const strip = await mountStrip();
		pageTrail.set("Email: 3");
		pageTypes.set({
			options: [
				{ value: "email-domain", label: "Email" },
				{ value: "file-domain", label: "File" },
			],
			selected: "email-domain",
		});
		await strip.updateComplete;
		// The combobox holds its own test id inside its root, so the strip's control is addressed by its class here.
		const types = strip.shadowRoot?.querySelector(".type-select") as HTMLElement & { options: Array<{ value: string }>; value: string; shown: string };
		expect(types.getAttribute("testid"), "a feature addresses it by the page's type select").toBe(`${PREFIX}type-select`);
		expect(types.getAttribute("slot"), "it stands in the breadcrumb's search entry, the entry that says what the search found").toBe("search");
		expect(types.shown, "and shows the search and its count").toBe("Email: 3");
		expect(types.options.map((o) => o.value)).toEqual(["email-domain", "file-domain"]);
		expect(types.value, "the type the search reads").toBe("email-domain");
		const chosen = vi.fn();
		document.addEventListener(SHU_EVENT.TYPE_CHOOSE, (e) => chosen((e as CustomEvent).detail), { once: true });
		types.dispatchEvent(new CustomEvent("combo-change", { detail: { value: "file-domain" }, bubbles: true, composed: true }));
		expect(chosen).toHaveBeenCalledWith({ key: "file-domain" });
	});

	it("says the page's status", async () => {
		const strip = await mountStrip();
		pageStatus.set("3 results");
		await strip.updateComplete;
		expect(control(strip, `${PREFIX}status`).textContent).toBe("3 results");
	});

	it("opens and closes the docked pane, and holds its controls disabled where no pane is docked", async () => {
		const strip = await mountStrip();
		expect(control(strip, SHU_TEST_IDS.APP.DOCK_TOGGLE).disabled, "nothing docked").toBe(true);
		const pane = await mountDockedPane();
		await settled(pane, strip);
		expect(control(strip, SHU_TEST_IDS.APP.DOCK_TOGGLE).disabled).toBe(false);
		control(strip, SHU_TEST_IDS.APP.DOCK_TOGGLE).click();
		await settled(pane, strip);
		expect(pane.isCollapsed, "the toggle opens the docked pane").toBe(false);
		control(strip, SHU_TEST_IDS.APP.DOCK_TOGGLE).click();
		await settled(pane, strip);
		expect(pane.isCollapsed, "and closes it").toBe(true);
	});

	it("pins the open docked pane without closing it, since a click in the strip isn't a click elsewhere", async () => {
		const strip = await mountStrip();
		const pane = await mountDockedPane();
		pane.open();
		await settled(pane, strip);
		control(strip, SHU_TEST_IDS.APP.DOCK_PIN).click();
		await settled(pane, strip);
		expect(pane.state.pinned, "the pin pins the pane").toBe(true);
		expect(pane.isCollapsed, "and the pane stays open").toBe(false);
		control(strip, SHU_TEST_IDS.APP.DOCK_PIN).click();
		await settled(pane, strip);
		expect(pane.state.pinned, "and unpins it").toBe(false);
	});

	it("changes the read access level the query reads at", async () => {
		pageContext.set({ patterns: [], accessLevel: Access.private });
		const strip = await mountStrip();
		const popover = strip.shadowRoot?.querySelector<HTMLElement>(".corner-popover") as HTMLElement;
		// jsdom has no top layer, so the popover's show states nothing.
		popover.showPopover = () => undefined;
		const asked = vi.fn();
		document.addEventListener(SHU_EVENT.FILTER_CHANGE, (e) => asked((e as CustomEvent).detail), { once: true });
		control(strip, `${PREFIX}access-indicator`).click();
		await strip.updateComplete;
		const permissions = strip.shadowRoot?.querySelector(`[data-testid="${PREFIX}permissions"]`) as HTMLElement & { onLevelChange: (level: string) => void };
		permissions.onLevelChange(Access.public);
		expect(asked).toHaveBeenCalledWith({ asked: true, accessLevel: Access.public });
		await strip.updateComplete;
		expect(control(strip, `${PREFIX}access-indicator`).textContent, "the indicator shows the level asked").toContain(Access.public);
	});
});
