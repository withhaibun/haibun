import { describe, it, expect } from "vitest";
import { groupCellSize, gridSlot } from "./group-grid.js";
import { shelfPack, groupBounds, GROUP_GAP, ENCLOSURE_PAD } from "../grouping.js";
import { collideRadius, chipTextHeight } from "./layout-forces.js";

// The end-to-end geometry the live grouped view must satisfy: size each group's cell (groupCellSize), shelf-pack the
// cells (shelfPack), pin members to their slots (gridSlot), draw each box (groupBounds with the SAME rx/ry the renderer
// uses): then assert NO two boxes overlap. This runs the exact functions the renderer runs, so a green test means the
// live view cannot overlap by construction; if the live view DOES overlap, the bundle being served is stale.
const member = (id: string, label: string) => ({ id, name: label, x: 0, y: 0, z: 0, isCluster: false });
// The extent of a member as the renderer measures it: its collision half-width and its chip height.
const ext = (m: { x?: number; y?: number; z?: number }) => ({ rx: collideRadius(m as ReturnType<typeof member>), ry: chipTextHeight(m as ReturnType<typeof member>) });

const boxesFor = (groups: ReadonlyMap<string, ReadonlyArray<ReturnType<typeof member>>>) => {
	const sizes = new Map([...groups].map(([k, members]) => [k, groupCellSize(members)]));
	const anchors = shelfPack(sizes, GROUP_GAP);
	return [...groups].map(([k, members]) => {
		const a = anchors.get(k);
		const s = sizes.get(k);
		if (!a || !s) throw new Error(`no anchor/size for ${k}`);
		const placed = members.map((m, i) => ({ ...m, ...gridSlot(a, s, i, members.length) }));
		const b = groupBounds(placed, ENCLOSURE_PAD, ext);
		if (!b) throw new Error(`no bounds for ${k}`);
		return { k, cell: s, anchor: a, minX: b.cx - b.sx / 2, maxX: b.cx + b.sx / 2, minY: b.cy - b.sy / 2, maxY: b.cy + b.sy / 2 };
	});
};

const overlapArea = (a: ReturnType<typeof boxesFor>[number], b: ReturnType<typeof boxesFor>[number]): number => {
	const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
	const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
	return ox > 0 && oy > 0 ? ox * oy : 0;
};

describe("grouped layout: enclosure boxes are mutually exclusive (no overlap)", () => {
	// The credentials/role case: a few small party containers + one big "(unattributed)" catch-all, plus an over-long id.
	const roleLike = new Map<string, ReturnType<typeof member>[]>([
		["Issuer", [member("i1", "Coastal Fisheries Authority")]],
		["Holder", [member("h1", "Tidewater Aquatics Co-op")]],
		["Verifier", [member("v1", "Port Inspection Service")]],
		["Registry", [member("r1", "Verifiable Data Registry")]],
		["unattributed", Array.from({ length: 9 }, (_, k) => member(`a${k}`, k === 0 ? `did:key:${"z".repeat(120)}` : `Artifact ${k}`))],
	]);

	it("no two role-grouped boxes overlap", () => {
		const boxes = boxesFor(roleLike);
		for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlapArea(boxes[i], boxes[j]), `${boxes[i].k} ∩ ${boxes[j].k}`).toBe(0);
	});

	it("each drawn box fits inside its reserved cell (box ⊆ cell), so shelf-pack spacing is sufficient", () => {
		for (const b of boxesFor(roleLike)) {
			expect(b.maxX - b.minX).toBeLessThanOrEqual(b.cell.w + 1e-6);
			expect(b.maxY - b.minY).toBeLessThanOrEqual(b.cell.h + 1e-6);
		}
	});

	// A type-grouped case: many small same-type containers (1-3 members), the manual "group by type" the user drives.
	const typeLike = new Map<string, ReturnType<typeof member>[]>(
		["VerifiableCredential", "Proof", "VerificationMethod", "BitstringStatusList", "VerifiablePresentation", "VerificationResult", "Issuer", "Holder", "Verifier"].map((t, i) => [
			t,
			Array.from({ length: (i % 3) + 1 }, (_, k) => member(`${t}-${k}`, `${t} ${k}`)),
		]),
	);

	it("no two type-grouped boxes overlap", () => {
		const boxes = boxesFor(typeLike);
		for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlapArea(boxes[i], boxes[j]), `${boxes[i].k} ∩ ${boxes[j].k}`).toBe(0);
	});
});
