// @vitest-environment jsdom
/**
 * The page strip stands along the bottom of the page whatever is docked above it. It names the search and the columns in
 * its breadcrumb, says the page's status, opens, closes and pins the docked pane, and changes the read access level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Access } from "@haibun/core/lib/resources.js";
import { buildConcernCatalog } from "@haibun/core/lib/hypermedia.js";
import { mapDefinitionsToDomains } from "@haibun/core/lib/domains.js";
import { provideLayout } from "../test/jsdom-layout.js";
import { ShuPageStrip } from "./shu-page-strip.js";
import { ShuColumnPane } from "./shu-column-pane.js";
import "./shu-breadcrumb.js";
import "./shu-combobox.js";
import { SHU_EVENT, SHU_TAG } from "../consts.js";
import { SHU_TEST_IDS } from "../test-ids.js";
import { activePane, dockedPane, pageContext, pageStatus, pageTrail, pageTypes, stripPanes } from "../signals.js";
import { setConcernCatalog } from "../rels-cache.js";
import { carryARun, setupShuTest } from "../test-setup.js";

provideLayout();

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
		// The page is a record of actuality, and actuality doesn't declare an extension for the strip.
		carryARun();
		setConcernCatalog(buildConcernCatalog(mapDefinitionsToDomains([])));
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

	it("opens and closes the docked pane, and holds its controls disabled where a pane isn't docked", async () => {
		const strip = await mountStrip();
		expect(control(strip, SHU_TEST_IDS.APP.DOCK_TOGGLE).disabled, "a pane isn't docked").toBe(true);
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

	it("changes the read access level the query reads at", async () => {
		pageContext.set({ patterns: [], accessLevel: Access.private });
		const strip = await mountStrip();
		const popover = strip.shadowRoot?.querySelector<HTMLElement>(".corner-popover") as HTMLElement;
		// jsdom doesn't have a top layer, so the popover's show doesn't change its state.
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
