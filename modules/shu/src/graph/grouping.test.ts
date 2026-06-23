import { describe, it, expect } from "vitest";
import { groupKeyOf, ringAnchors, packLayout, groupBounds, ENCLOSURE_MIN_THICK, easeInOutCubic, UNATTRIBUTED_ROLE } from "./grouping.js";
import { HYPERMEDIA_ROLE_KEY } from "../graph-model.js";

describe("groupKeyOf", () => {
	it("keys a node by its type (the default axis)", () => {
		expect(groupKeyOf({ type: "Email" })).toBe("Email");
	});

	it("keys by HypermediaRole under the role axis", () => {
		expect(groupKeyOf({ type: "VerifiableCredential", properties: { [HYPERMEDIA_ROLE_KEY]: "did:web:issuer" } }, "role")).toBe("did:web:issuer");
	});

	it("buckets an unattributed node under the role axis", () => {
		expect(groupKeyOf({ type: "Email" }, "role")).toBe(UNATTRIBUTED_ROLE);
	});

	it("ignores a folded role under the type axis (stays byte-identical)", () => {
		expect(groupKeyOf({ type: "Email", properties: { [HYPERMEDIA_ROLE_KEY]: "did:web:x" } })).toBe("Email");
	});
});

describe("ringAnchors", () => {
	it("returns an empty map for no groups", () => {
		expect(ringAnchors([], 50).size).toBe(0);
	});

	it("places a single group at the origin (nothing to separate)", () => {
		expect(ringAnchors(["A"], 50).get("A")).toEqual({ x: 0, y: 0 });
	});

	it("spreads N groups evenly on a circle of the given radius", () => {
		const a = ringAnchors(["A", "B", "C", "D"], 50);
		expect(a.size).toBe(4);
		for (const pt of a.values()) expect(Math.hypot(pt.x, pt.y)).toBeCloseTo(50, 6);
		expect(a.get("A")).toMatchObject({ x: expect.closeTo(50, 6), y: expect.closeTo(0, 6) });
		expect(a.get("C")).toMatchObject({ x: expect.closeTo(-50, 6), y: expect.closeTo(0, 6) });
	});

	it("preserves the given key order (caller sorts for stability)", () => {
		expect([...ringAnchors(["X", "Y"], 10).keys()]).toEqual(["X", "Y"]);
	});
});

describe("packLayout", () => {
	const radii = new Map([
		["Email", 140],
		["Person", 77],
		["Body", 166],
		["Kihan", 35],
		["SeqPath", 120],
		["File", 60],
		["Endpoint", 45],
	]);
	const gap = 80;

	it("single group sits at the origin", () => {
		expect(packLayout(new Map([["A", 130]]), gap).get("A")).toEqual({ x: 0, y: 0 });
	});

	it("every pair of groups is separated by at least their radii plus the gap (no overlapping boxes)", () => {
		const anchors = packLayout(radii, gap);
		const keys = [...radii.keys()];
		for (let i = 0; i < keys.length; i++) {
			for (let j = i + 1; j < keys.length; j++) {
				const a = anchors.get(keys[i]);
				const b = anchors.get(keys[j]);
				if (!a || !b) throw new Error("missing anchor");
				const d = Math.hypot(a.x - b.x, a.y - b.y);
				expect(d).toBeGreaterThanOrEqual((radii.get(keys[i]) ?? 0) + (radii.get(keys[j]) ?? 0) + gap - 1e-6);
			}
		}
	});

	it("packs to a roughly square footprint (fills width AND height, not a thin strip or ring annulus)", () => {
		const anchors = packLayout(radii, gap);
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const [k, a] of anchors) {
			const r = radii.get(k) ?? 0;
			minX = Math.min(minX, a.x - r);
			maxX = Math.max(maxX, a.x + r);
			minY = Math.min(minY, a.y - r);
			maxY = Math.max(maxY, a.y + r);
		}
		const aspect = (maxX - minX) / (maxY - minY);
		expect(aspect).toBeGreaterThan(0.4);
		expect(aspect).toBeLessThan(2.5);
		// centred on the origin so the camera target is the middle of the content
		expect(Math.abs((minX + maxX) / 2)).toBeLessThan(1);
		expect(Math.abs((minY + maxY) / 2)).toBeLessThan(1);
	});
});

describe("groupBounds", () => {
	it("is null for an empty group", () => {
		expect(groupBounds([], 6)).toBeNull();
	});

	it("centres on the members and pads the extent by 2×pad on each axis", () => {
		const b = groupBounds(
			[
				{ x: 0, y: 0, z: 0 },
				{ x: 10, y: 20, z: 4 },
			],
			5,
		);
		expect(b).toMatchObject({ cx: 5, cy: 10, cz: 2, sx: 20, sy: 30, sz: 14 });
	});

	it("treats missing coordinates as 0 and floors every dimension to the minimum thickness (flat/2D layout)", () => {
		const b = groupBounds([{ x: 3 }, { x: 3 }], 0);
		expect(b).toMatchObject({ cx: 3, cy: 0, cz: 0, sx: ENCLOSURE_MIN_THICK, sy: ENCLOSURE_MIN_THICK, sz: ENCLOSURE_MIN_THICK });
	});

	it("expands the box by each member's own extents (chips are wide billboards, not points)", () => {
		const b = groupBounds([{ x: 0, y: 0, z: 0 }], 0, () => ({ rx: 20, ry: 4 }));
		expect(b).toMatchObject({ sx: 40, sy: 8 });
	});

	it("contains every member within the padded box (the 'exclusive area' invariant)", () => {
		const members = [
			{ x: -4, y: 7, z: 1 },
			{ x: 12, y: -3, z: 9 },
			{ x: 5, y: 5, z: 5 },
		];
		const b = groupBounds(members, 6);
		if (!b) throw new Error("expected bounds for a non-empty group");
		for (const m of members) {
			expect(Math.abs(m.x - b.cx)).toBeLessThanOrEqual(b.sx / 2);
			expect(Math.abs(m.y - b.cy)).toBeLessThanOrEqual(b.sy / 2);
			expect(Math.abs(m.z - b.cz)).toBeLessThanOrEqual(b.sz / 2);
		}
	});
});

describe("easeInOutCubic", () => {
	it("pins the endpoints and is symmetric, slow-in slow-out", () => {
		expect(easeInOutCubic(0)).toBe(0);
		expect(easeInOutCubic(1)).toBe(1);
		expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
		expect(easeInOutCubic(0.25)).toBeLessThan(0.25); // slow start
	});
});
