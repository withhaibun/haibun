import { describe, it, expect } from "vitest";
import { groupKeyOf, containerLabelOf, ringAnchors, shelfPack, groupBounds, ENCLOSURE_MIN_THICK, easeInOutCubic, UNATTRIBUTED_ROLE } from "./grouping.js";
import { SITE_KEY, HYPERMEDIA_ROLE_KEY } from "../graph-model.js";

describe("groupKeyOf", () => {
	it("keys a node by its type (the default axis)", () => {
		expect(groupKeyOf({ type: "Email" })).toBe("Email");
	});

	it("keys by HypermediaRole under the role axis", () => {
		expect(groupKeyOf({ type: "Record", properties: { [HYPERMEDIA_ROLE_KEY]: "did:web:maker" } }, "role")).toBe("did:web:maker");
	});

	it("buckets an unattributed node under the role axis", () => {
		expect(groupKeyOf({ type: "Email" }, "role")).toBe(UNATTRIBUTED_ROLE);
	});

	it("ignores a folded role under the type axis (stays byte-identical)", () => {
		expect(groupKeyOf({ type: "Email", properties: { [HYPERMEDIA_ROLE_KEY]: "did:web:x" } })).toBe("Email");
	});

	it("keys by the agent at ANY actor predicate — the axis string IS the predicate, nothing enumerates it", () => {
		const vc = { type: "Record", properties: { maker: "did:web:maker", keeper: "did:web:keeper" } };
		expect(groupKeyOf(vc, "maker")).toBe("did:web:maker"); // group by a SPECIFIC actor, not the winner
		expect(groupKeyOf(vc, "keeper")).toBe("did:web:keeper");
	});

	it("keys by the serving site (the federation stamp) with no code branch for it", () => {
		expect(groupKeyOf({ type: "Email", properties: { [SITE_KEY]: "did:site:imap.1" } }, SITE_KEY)).toBe("did:site:imap.1");
	});

	it("buckets a node with no value at the chosen axis as unattributed", () => {
		expect(groupKeyOf({ type: "Email", properties: {} }, SITE_KEY)).toBe(UNATTRIBUTED_ROLE);
	});
});

describe("containerLabelOf", () => {
	it("uses the type key directly under the type axis", () => {
		expect(containerLabelOf("Email", "type", new Map([["Email", "ignored"]]))).toBe("Email");
	});
	it("resolves the party's display label under the role axis", () => {
		expect(containerLabelOf("did:web:maker", "role", new Map([["did:web:maker", "Coastal Fisheries Authority"]]))).toBe("Coastal Fisheries Authority");
	});
	it("falls back to the key when no label is known", () => {
		expect(containerLabelOf("did:web:x", "role", new Map())).toBe("did:web:x");
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

describe("shelfPack — compact rectangle packing on real {w,h} (no isotropic blow-up)", () => {
	const GAP = 80;
	// A mix of tall-thin, square, tiny — and C: one VERY WIDE, SHORT container (the long-base64-id case).
	const sizes = new Map([
		["A", { w: 40, h: 40 }],
		["B", { w: 30, h: 90 }],
		["C", { w: 300, h: 14 }],
		["D", { w: 50, h: 50 }],
		["E", { w: 20, h: 20 }],
	]);
	const keys = [...sizes.keys()];
	const pack = shelfPack(sizes, GAP);
	const box = (k: string) => {
		const c = pack.get(k);
		const s = sizes.get(k);
		if (!c || !s) throw new Error(`missing ${k}`);
		return { minX: c.x - s.w / 2, maxX: c.x + s.w / 2, minY: c.y - s.h / 2, maxY: c.y + s.h / 2 };
	};
	const boxes = () => keys.map((k) => box(k));
	const span = (sel: (b: ReturnType<typeof box>) => number, lo: boolean) => (lo ? Math.min(...boxes().map(sel)) : Math.max(...boxes().map(sel)));

	it("an empty map packs to nothing; a single container sits at the origin", () => {
		expect(shelfPack(new Map(), GAP).size).toBe(0);
		expect(shelfPack(new Map([["only", { w: 100, h: 20 }]]), GAP).get("only")).toEqual({ x: 0, y: 0 });
	});

	it("every pair of containers is AABB-disjoint with at least GAP clear on the separating axis", () => {
		for (let i = 0; i < keys.length; i++)
			for (let j = i + 1; j < keys.length; j++) {
				const a = box(keys[i]);
				const b = box(keys[j]);
				const gapX = Math.max(b.minX - a.maxX, a.minX - b.maxX);
				const gapY = Math.max(b.minY - a.maxY, a.minY - b.maxY);
				expect(Math.max(gapX, gapY), `${keys[i]} vs ${keys[j]} must clear by GAP`).toBeGreaterThanOrEqual(GAP - 1e-6);
			}
	});

	it("a wide-SHORT container does NOT leak its width into the layout HEIGHT — the disc-model bug", () => {
		const totalH = span((b) => b.maxY, false) - span((b) => b.minY, true);
		const sumCellH = [...sizes.values()].reduce((s, v) => s + v.h + GAP, 0);
		expect(totalH).toBeLessThanOrEqual(sumCellH);
		expect(totalH, "the 300-wide C must not make the layout ~300 tall").toBeLessThan(300);
	});

	it("packs compactly — bounding-box area within 4× the summed cell areas", () => {
		const totalW = span((b) => b.maxX, false) - span((b) => b.minX, true);
		const totalH = span((b) => b.maxY, false) - span((b) => b.minY, true);
		const sumArea = [...sizes.values()].reduce((s, v) => s + (v.w + GAP) * (v.h + GAP), 0);
		expect(totalW * totalH).toBeLessThanOrEqual(4 * sumArea);
	});

	it("is centred on the origin (the camera target is the middle of the content)", () => {
		expect(Math.abs((span((b) => b.minX, true) + span((b) => b.maxX, false)) / 2)).toBeLessThan(1e-6);
		expect(Math.abs((span((b) => b.minY, true) + span((b) => b.maxY, false)) / 2)).toBeLessThan(1e-6);
	});

	it("is a pure function of the map CONTENT — insertion order does not change the result, and key order is the sort order", () => {
		const reversed = new Map([...sizes.entries()].reverse());
		expect(shelfPack(reversed, GAP)).toEqual(pack);
		expect([...pack.keys()]).toEqual(["B", "D", "A", "E", "C"]); // ch desc, then cw desc, then key asc
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
