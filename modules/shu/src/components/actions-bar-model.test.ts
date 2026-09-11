/**
 * What the actions bar works out before it draws anything: what to call the current context, how tall to open, where
 * a drag leaves it, and how far along a run the cursor sits. Each is read here without a browser.
 */
import { describe, it, expect } from "vitest";
import { anIndividual, aType } from "../schemas.js";
import { contextLabel, draggedHeight, draggedProportion, isEntitySelection, openAtProportion, timeOffsetLabel, MIN_PANEL_PX, PROPORTION } from "./actions-bar-model.js";

describe("what the bar calls the current context", () => {
	it("names one selected record, and counts several", () => {
		expect(contextLabel([anIndividual("Email", "msg-1")])).toBe("msg-1");
		expect(contextLabel([anIndividual("Email", "msg-1"), anIndividual("Email", "msg-2")])).toBe("2 items");
	});

	it("names a type by what the view behind it holds", () => {
		expect(contextLabel([aType("Email", [{ predicate: "subject", operator: "contains", value: "invoice" }])], { label: "Email", total: 12, folder: "INBOX" })).toBe(
			"Email: 12 in INBOX",
		);
	});

	it("names a type by the type itself where the view offers nothing, which is what a schema view offers", () => {
		expect(contextLabel([aType("Email")])).toBe("Email:");
	});

	it("is All with nothing selected, since the bar then acts on everything", () => {
		expect(contextLabel([])).toBe("All");
	});

	it("tells a selection of records from a type to query over", () => {
		expect(isEntitySelection([anIndividual("Email", "msg-1"), anIndividual("Email", "msg-2")])).toBe(true);
		expect(isEntitySelection([aType("Email")])).toBe(false);
		expect(isEntitySelection([])).toBe(false);
	});
});

describe("how tall the bar opens", () => {
	it("opens at the height that was dragged, when that is still one a reader can work in", () => {
		expect(openAtProportion(0.5)).toBe(0.5);
	});

	it("opens at its default when the remembered height is outside what it will honour", () => {
		expect(openAtProportion(0.01)).toBe(PROPORTION.default);
		expect(openAtProportion(0.99)).toBe(PROPORTION.default);
		expect(openAtProportion(0)).toBe(PROPORTION.default);
	});
});

describe("where a drag leaves the bar", () => {
	const container = 1000;

	it("grows upward: the bar is anchored at the bottom, so dragging the top edge up makes it taller", () => {
		expect(draggedHeight(300, 700, 600, container)).toBe(400);
		expect(draggedHeight(300, 700, 800, container)).toBe(200);
	});

	it("keeps a usable strip and never exceeds its container", () => {
		expect(draggedHeight(300, 700, 2000, container)).toBe(MIN_PANEL_PX);
		expect(draggedHeight(300, 700, -2000, container)).toBe(container);
	});

	it("remembers a finished drag as a fraction, so the bar stays proportionate at another window size", () => {
		expect(draggedProportion(400, container)).toBe(0.4);
		expect(draggedProportion(10, container)).toBe(PROPORTION.min);
		expect(draggedProportion(990, container)).toBe(PROPORTION.max);
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
