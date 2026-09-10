import { describe, it, expect } from "vitest";
import { VIEW, viewChangeRebuildsNodes } from "./polymorphic-views.js";

// The render-on-first-switch bug in the flesh: entering the sequence turns participant chips into activation BOXES, so the
// lib's identity-cached node objects MUST be rebuilt on the crossing, while a force↔td↔lr switch keeps the chips and must
// not. A pure decision, asserted headless so the "stale node objects on a view switch" class of bug can't return unseen.
describe("viewChangeRebuildsNodes, node-shape boundary → rebuild", () => {
	it("rebuilds entering OR leaving the sequence (chip ↔ activation bar)", () => {
		expect(viewChangeRebuildsNodes(VIEW.force, VIEW.sequence)).toBe(true);
		expect(viewChangeRebuildsNodes(VIEW.sequence, VIEW.force)).toBe(true);
		expect(viewChangeRebuildsNodes(VIEW.td, VIEW.sequence)).toBe(true);
	});
	it("rebuilds between the two bar views (gantt bar and sequence bar differ by the rotated label)", () => {
		expect(viewChangeRebuildsNodes(VIEW.gantt, VIEW.sequence)).toBe(true);
		expect(viewChangeRebuildsNodes(VIEW.sequence, VIEW.gantt)).toBe(true);
	});
	it("rebuilds entering OR leaving gantt (chip ↔ duration bar)", () => {
		expect(viewChangeRebuildsNodes(VIEW.force, VIEW.gantt)).toBe(true);
		expect(viewChangeRebuildsNodes(VIEW.gantt, VIEW.lr)).toBe(true);
	});
	it("does NOT rebuild within the chip family (force ↔ td ↔ lr keep their chips)", () => {
		expect(viewChangeRebuildsNodes(VIEW.force, VIEW.td)).toBe(false);
		expect(viewChangeRebuildsNodes(VIEW.td, VIEW.lr)).toBe(false);
		expect(viewChangeRebuildsNodes(VIEW.lr, VIEW.force)).toBe(false);
		expect(viewChangeRebuildsNodes(VIEW.force, VIEW.force)).toBe(false);
	});
});
