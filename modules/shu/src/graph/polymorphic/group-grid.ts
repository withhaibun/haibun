/**
 * The pure geometry of a grouped container's footprint: the RECTANGLE cell a group reserves, and the slot each member
 * is pinned to inside it. Kept pure (no DOM, no force) and shared by the enclosure (which sizes + shelf-packs the cells)
 * and the data pipeline (which pins members to the slots), so the box-fits-cell + no-overlap invariants are unit-proven
 * on the SAME functions the renderer runs — not a re-derivation that can drift.
 */
import { collideRadius, chipTextHeight, type LayoutNode } from "./layout-forces.js";
import { GROUP_SPREAD, IN_CELL_GAP } from "../grouping.js";

/** The √count grid a group reserves: side = ⌈√count⌉ slots, each the WIDEST member's footprint plus in-cell breathing
 *  room — so a wide member makes a wide-short cell, a populous group a bigger grid, and (with bounded collideRadius) one
 *  long id can't inflate it. The members, grid-placed, always fit inside this cell (proven in group-grid.test.ts). */
export function groupCellSize(members: ReadonlyArray<LayoutNode>): { w: number; h: number } {
	const side = Math.ceil(Math.sqrt(members.length));
	const slotW = Math.max(...members.map((n) => 2 * collideRadius(n))) + IN_CELL_GAP;
	const slotH = Math.max(...members.map((n) => 2 * chipTextHeight(n))) + IN_CELL_GAP;
	return { w: Math.max(side * slotW, GROUP_SPREAD), h: Math.max(side * slotH, GROUP_SPREAD) };
}

/** A member's slot CENTRE on its group's grid (relative to the group anchor) — the deterministic position the force
 *  pins it to, so the drawn box equals the reserved cell and shelf-packed cells never collide. */
export function gridSlot(anchor: { x: number; y: number }, size: { w: number; h: number }, index: number, count: number): { x: number; y: number } {
	const side = Math.ceil(Math.sqrt(count));
	return {
		x: anchor.x + ((index % side) - (side - 1) / 2) * (size.w / side),
		y: anchor.y + (Math.floor(index / side) - (side - 1) / 2) * (size.h / side),
	};
}
