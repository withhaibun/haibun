/**
 * The pick/projection invariant, proved without a browser: aiming at a node and identifying it back are one mapping
 * read in two directions, so they must round-trip exactly. Drift between them is the "N nodes, none pickable at centre"
 * failure — a node that cannot be picked where it is drawn.
 *
 * The raycast itself needs a real browser (a feature test covers it); this is the arithmetic under it.
 */
import { describe, it, expect } from "vitest";
import { ndcToClient, clientToNdc, ndcOnScreen, NDC_EDGE, type TCanvasRect, type TNdc, type TClientPoint } from "./polymorphic-project.js";

/** The round trip is arithmetic, not measurement: it holds to floating-point precision, not to a tolerance. */
const EXACT_DIGITS = 10;

const RECTS: Array<[string, TCanvasRect]> = [
	["origin", { left: 0, top: 0, width: 700, height: 500 }],
	["offset (the graph sits beside a column strip)", { left: 320, top: 48, width: 960, height: 720 }],
	["non-square", { left: 12.5, top: 7.25, width: 333, height: 999 }],
];

const NDC_SAMPLES: TNdc[] = [
	{ x: 0, y: 0 },
	{ x: -NDC_EDGE, y: -NDC_EDGE },
	{ x: NDC_EDGE, y: NDC_EDGE },
	{ x: 0.37, y: -0.82 },
	{ x: -0.5, y: 0.25 },
];

describe("fisheye node projection", () => {
	for (const [name, rect] of RECTS) {
		const centre: TClientPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

		it(`centres the middle of the NDC box in the canvas — ${name}`, () => {
			expect(ndcToClient({ x: 0, y: 0 }, rect)).toEqual(centre);
		});

		it(`reads NDC y up against client y down — ${name}`, () => {
			expect(ndcToClient({ x: 0, y: NDC_EDGE }, rect).y).toBe(rect.top);
			expect(ndcToClient({ x: 0, y: -NDC_EDGE }, rect).y).toBe(rect.top + rect.height);
		});

		it(`maps the NDC corners to the canvas corners — ${name}`, () => {
			expect(ndcToClient({ x: -NDC_EDGE, y: NDC_EDGE }, rect)).toEqual({ x: rect.left, y: rect.top });
			expect(ndcToClient({ x: NDC_EDGE, y: -NDC_EDGE }, rect)).toEqual({ x: rect.left + rect.width, y: rect.top + rect.height });
		});

		// The invariant the drag rests on: project a node to a pixel, pick that pixel, and the ray reads back the
		// coordinates the node was projected from — so the node picks where it is drawn.
		it(`picks back the NDC it projected — ${name}`, () => {
			for (const ndc of NDC_SAMPLES) {
				const back = clientToNdc(ndcToClient(ndc, rect), rect);
				expect(back.x).toBeCloseTo(ndc.x, EXACT_DIGITS);
				expect(back.y).toBeCloseTo(ndc.y, EXACT_DIGITS);
			}
		});

		it(`projects back the pixel it picked — ${name}`, () => {
			const points: TClientPoint[] = [{ x: rect.left, y: rect.top }, centre, { x: rect.left + rect.width, y: rect.top + rect.height }, { x: rect.left + 123, y: rect.top + 45 }];
			for (const point of points) {
				const back = ndcToClient(clientToNdc(point, rect), rect);
				expect(back.x).toBeCloseTo(point.x, EXACT_DIGITS);
				expect(back.y).toBeCloseTo(point.y, EXACT_DIGITS);
			}
		});
	}

	it("reads a pixel outside the canvas as NDC outside the box, so an off-canvas aim never resolves onto a node", () => {
		const rect: TCanvasRect = { left: 100, top: 100, width: 200, height: 200 };
		const inside = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		expect(ndcOnScreen(clientToNdc(inside, rect))).toBe(true);
		for (const outside of [
			{ x: rect.left - 50, y: inside.y },
			{ x: rect.left + rect.width + 50, y: inside.y },
			{ x: inside.x, y: rect.top - 50 },
			{ x: inside.x, y: rect.top + rect.height + 50 },
		]) {
			expect(ndcOnScreen(clientToNdc(outside, rect))).toBe(false);
		}
	});
});
