// @vitest-environment jsdom
/**
 * The page strip's corners, held apart from the strip: one popover open at a time, how each corner's popover closes, what
 * the access indicator says a reader holds and what awaits them, and the status on the strip. jsdom has no top layer, so
 * the popover's show and hide are stated by each case.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { AWAITING_DECISION } from "../consts.js";
import { PageStripCorners, CORNERS, awaitingOf, timeOffsetLabel } from "./page-strip-corners.js";
import { aControllerHost, type ControllerHostFake } from "./controller-host.test-fake.js";
import { PERMISSIONS_SUMMARY } from "./shu-permissions.js";
import { REF_KIND } from "./ref-navigation.js";

/** A kind of reference a ref opens. */
const OPENABLE = REF_KIND[1];

const PREFIX = "app-";
/** The corner used beside the view, which only its own control closes; every other corner is a picker. */
const PANEL = "playback";

type TCornersPage = { host: ControllerHostFake; corners: PageStripCorners; popover: HTMLElement & { shown: boolean } };

function aCornersPage(): TCornersPage {
	const host = aControllerHost();
	const popover = Object.assign(document.createElement("div"), { className: "corner-popover", shown: false });
	host.append(popover);
	popover.showPopover = vi.fn(() => {
		popover.shown = true;
	});
	popover.hidePopover = vi.fn(() => {
		popover.shown = false;
	});
	popover.matches = (selector: string) => selector === ":popover-open" && popover.shown;
	const corners = new PageStripCorners(host, {
		testIdPrefix: () => PREFIX,
		anchorTop: () => host.getBoundingClientRect().top,
		accessLevel: () => "all",
		setAccessLevel: () => undefined,
	});
	corners.hostConnected();
	return { host, corners, popover };
}

/** Render the strip's corner controls and status into the host, as the strip composes them. */
function renderControls({ host, corners }: TCornersPage): void {
	render([corners.statusTemplate(), corners.controlsTemplate()], host);
}

const control = (host: HTMLElement, testId: string) => host.querySelector<HTMLElement>(`[data-testid="${PREFIX}${testId}"]`) as HTMLElement;
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Press a control inside the strip that toggles the corner, as the strip's own controls do. */
function pressCorner({ host, corners }: TCornersPage, corner: (typeof CORNERS)[number]): void {
	const button = document.createElement("button");
	button.addEventListener("click", corners.toggle(corner));
	host.append(button);
	button.click();
	button.remove();
}

describe("the page strip's corners", () => {
	it("open one popover at a time above the strip, and close the corner open when its control is pressed again", async () => {
		const page = aCornersPage();
		renderControls(page);
		control(page.host, "settings-button").click();
		await settled();
		expect(page.corners.openCorner).toBe("settings");
		expect(page.popover.showPopover).toHaveBeenCalledTimes(1);
		control(page.host, "access-indicator").click();
		await settled();
		expect(page.corners.openCorner, "opening another corner replaces it").toBe("access");
		control(page.host, "access-indicator").click();
		expect(page.corners.openCorner).toBeNull();
		expect(page.popover.hidePopover).toHaveBeenCalledTimes(1);
	});

	it("close a picker on a click elsewhere, leave the playback panel open, and close nothing on a click inside the strip", async () => {
		const page = aCornersPage();
		renderControls(page);
		for (const corner of CORNERS) {
			pressCorner(page, corner);
			await settled();
			page.host.click();
			expect(page.corners.openCorner, `${corner}: a click inside the strip`).toBe(corner);
			document.body.click();
			expect(page.corners.openCorner, `${corner}: a click elsewhere`).toBe(corner === PANEL ? corner : null);
			page.corners.close();
		}
	});

	it("mark what awaits the reader from the detail an extension reports, and ignore a detail with no count", () => {
		expect(awaitingOf({ count: 2, kind: OPENABLE, target: { id: "a" } })).toEqual({ count: 2, ref: { kind: OPENABLE, target: { id: "a" } } });
		expect(awaitingOf({ count: -1, kind: "elsewhere", target: { id: "a" } }), "no count below zero, and no reference of a kind a ref cannot open").toEqual({ count: 0, ref: null });
		expect(awaitingOf({ count: "several" })).toBeNull();
		const page = aCornersPage();
		document.dispatchEvent(new CustomEvent(AWAITING_DECISION, { detail: { count: 3, kind: OPENABLE, target: { id: "a" } } }));
		document.dispatchEvent(new CustomEvent(AWAITING_DECISION, { detail: { count: "several" } }));
		renderControls(page);
		expect(control(page.host, "access-indicator").querySelector(".awaiting-count")?.textContent).toBe("3");
	});

	it("show on the access indicator the authority the permissions panel reports", () => {
		const page = aCornersPage();
		page.host.dispatchEvent(new CustomEvent(PERMISSIONS_SUMMARY, { detail: { holds: 1, principals: 2, grants: 3 } }));
		renderControls(page);
		expect(control(page.host, "access-indicator").textContent?.replace(/\s+/g, "")).toBe("all+1+2+3");
	});

	it("show the status on the strip while there is one", () => {
		const page = aCornersPage();
		renderControls(page);
		expect(control(page.host, "status").style.display).toBe("none");
		page.corners.setStatus("the server did not respond");
		renderControls(page);
		expect(control(page.host, "status").style.display).toBe("");
		expect(control(page.host, "status").textContent).toBe("the server did not respond");
	});
});

describe("how far along a run the cursor sits", () => {
	const first = 1_000_000;
	const latest = first + 600_000;

	it("says the moment out of the whole run, so a reader can tell near-the-start from near-the-end", () => {
		// A ten minute run: two minutes in reads as two of ten. On its own, "2m" says nothing about where in the run that
		// is, which is the one thing that matters from a readout this small.
		expect(timeOffsetLabel(first + 120_000, first, latest)).toBe("2/10m");
		expect(timeOffsetLabel(first + 540_000, first, latest)).toBe("9/10m");
	});

	it("counts a short run in seconds, both halves in the same unit so they can be read against each other", () => {
		const short = first + 40_000;
		expect(timeOffsetLabel(first + 11_000, first, short)).toBe("11/40s");
	});

	it("reads now at the latest moment and beyond it, and with no cursor at all", () => {
		expect(timeOffsetLabel(latest, first, latest)).toBe("now");
		expect(timeOffsetLabel(latest + 1, first, latest)).toBe("now");
		expect(timeOffsetLabel(null, first, latest)).toBe("now");
	});
});
