/**
 * What a docked pane works out before it draws anything: how tall it opens and where a drag of its top edge leaves it.
 */
import { describe, it, expect } from "vitest";
import { draggedHeight, draggedProportion, openAtProportion, MIN_PANEL_PX, PROPORTION } from "./dock-model.js";

describe("how tall a docked pane opens", () => {
	it("opens at the height that was dragged, when that is still one a reader can work in", () => {
		expect(openAtProportion(0.5)).toBe(0.5);
	});

	it("opens at its default when the remembered height is outside what it will honour, or it remembers none", () => {
		expect(openAtProportion(0.01)).toBe(PROPORTION.default);
		expect(openAtProportion(0.99)).toBe(PROPORTION.default);
		expect(openAtProportion(0)).toBe(PROPORTION.default);
		expect(openAtProportion(undefined)).toBe(PROPORTION.default);
	});
});

describe("where a drag leaves a docked pane", () => {
	const container = 1000;

	it("grows upward: the pane is anchored at the bottom, so dragging the top edge up makes it taller", () => {
		expect(draggedHeight(300, 700, 600, container)).toBe(400);
		expect(draggedHeight(300, 700, 800, container)).toBe(200);
	});

	it("keeps a usable strip and never exceeds its container", () => {
		expect(draggedHeight(300, 700, 2000, container)).toBe(MIN_PANEL_PX);
		expect(draggedHeight(300, 700, -2000, container)).toBe(container);
	});

	it("remembers a finished drag as a fraction, so the pane stays proportionate at another window size", () => {
		expect(draggedProportion(400, container)).toBe(0.4);
		expect(draggedProportion(10, container)).toBe(PROPORTION.min);
		expect(draggedProportion(990, container)).toBe(PROPORTION.max);
	});
});
