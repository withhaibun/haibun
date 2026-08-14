/**
 * What the actions bar works out before it draws anything: what to call the current context, how tall to open, where
 * a drag leaves it, and how far along a run the cursor sits. Each is read here without a browser.
 */
import { describe, it, expect } from "vitest";
import { contextLabel, draggedHeight, draggedProportion, isEntitySelection, openAtProportion, timeOffsetLabel, MIN_PANEL_PX, PROPORTION } from "./actions-bar-model.js";

describe("what the bar calls the current context", () => {
	it("names one selected record, and counts several", () => {
		expect(contextLabel([{ s: "msg-1" }])).toBe("msg-1");
		expect(contextLabel([{ s: "msg-1" }, { s: "msg-2" }])).toBe("2 items");
	});

	it("names a single field by the property it is", () => {
		expect(contextLabel([{ s: "msg-1", p: "subject" }])).toBe("subject");
	});

	it("falls back to what the view holds when the patterns describe a query rather than a selection", () => {
		expect(contextLabel([{ p: "subject", o: "invoice" }], { label: "Email", total: 12, folder: "INBOX" })).toBe("Email: 12 in INBOX");
	});

	it("is All with nothing selected, since the bar then acts on everything", () => {
		expect(contextLabel([])).toBe("All");
		expect(contextLabel([{ p: "subject" }]), "and with a query the view says nothing about").toBe("All");
	});

	it("tells a selection of records from a query over them", () => {
		expect(isEntitySelection([{ s: "msg-1" }, { s: "msg-2" }])).toBe(true);
		expect(isEntitySelection([{ s: "msg-1", p: "subject" }])).toBe(false);
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

	it("counts seconds from the first moment seen, then minutes once there are enough of them", () => {
		expect(timeOffsetLabel(first + 5_000, first, latest)).toBe("5s");
		expect(timeOffsetLabel(first + 120_000, first, latest)).toBe("2m");
	});

	it("reads now at the latest moment and beyond it, and with no cursor at all", () => {
		expect(timeOffsetLabel(latest, first, latest)).toBe("now");
		expect(timeOffsetLabel(latest + 1, first, latest)).toBe("now");
		expect(timeOffsetLabel(null, first, latest)).toBe("now");
	});
});
