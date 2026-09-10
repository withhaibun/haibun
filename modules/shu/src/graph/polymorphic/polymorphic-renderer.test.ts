/**
 * What a change drew, read from the renderer the scene draws through.
 *
 * "It did not redraw after changing the view" was a question only a browser could answer: drive a page, switch a view,
 * compare pixels, wait for the layout to settle. A renderer that records what it was given answers it here: a view
 * change places the nodes differently, a repaint that changes nothing places them identically, and a shape rebuild has
 * its place in the order.
 */
import { describe, expect, it } from "vitest";
import { compositeRenderer, graphSummary, RecordingRenderer, samePlacement, threeRenderer } from "./polymorphic-renderer.js";
import type { FGLink, FGNode } from "./polymorphic-graph-types.js";

const nodes = (places: Array<[string, number, number, number]>): FGNode[] => places.map(([id, x, y, z]) => ({ id, name: id, type: "Comment", x, y, z }));
const links = (pairs: Array<[string, string]>): FGLink[] => pairs.map(([source, target]) => ({ source, target, predicate: "narrate" }));

describe("what a renderer was given", () => {
	it("says a view change placed the nodes differently, which is what a redraw is", () => {
		const r = new RecordingRenderer();
		r.draw({
			nodes: nodes([
				["a", 0, 0, 0],
				["b", 10, 0, 0],
			]),
			links: links([["a", "b"]]),
		}); // the force view
		const before = r.last;
		r.draw({
			nodes: nodes([
				["a", 100, 40, 0],
				["b", 220, 40, 0],
			]),
			links: links([["a", "b"]]),
		}); // the same graph read as a flow
		expect(samePlacement(before, r.last)).toBe(false);
		expect(r.placements).toHaveLength(2);
	});

	it("says a repaint that changed nothing placed the nodes identically, so a repaint that should be skipped is visible as one", () => {
		const r = new RecordingRenderer();
		const same = () => ({ nodes: nodes([["a", 5, 5, 5]]), links: links([]) });
		r.draw(same());
		const before = r.last;
		r.draw(same());
		expect(samePlacement(before, r.last)).toBe(true);
	});

	it("gives a shape rebuild its place in the order, so a chip that became a bar is read in sequence", () => {
		const r = new RecordingRenderer();
		r.draw({ nodes: nodes([["a", 0, 0, 0]]), links: links([]) });
		r.rebuildNodes(); // the view crossed a node-shape boundary
		r.draw({ nodes: nodes([["a", 0, 40, 12]]), links: links([]) });
		expect(r.rebuilds).toEqual([1]); // after the first display, before the second
		expect(r.placements).toHaveLength(2);
	});

	it("carries the links it was given, so an edge that vanished from a reading is visible", () => {
		const r = new RecordingRenderer();
		r.draw({
			nodes: nodes([
				["a", 0, 0, 0],
				["b", 1, 1, 1],
			]),
			links: links([["a", "b"]]),
		});
		r.draw({
			nodes: nodes([
				["a", 0, 0, 0],
				["b", 1, 1, 1],
			]),
			links: links([]),
		});
		expect(r.linkCounts).toEqual([1, 0]);
	});

	it("hands the graph library a fresh node factory per rebuild, which is the only way it re-runs one it already cached", () => {
		// The library caches each node's object and re-runs the factory only when the accessor is a different function.
		// Passing the same one leaves every node wearing the shape it had: a pin that never gets its frame.
		const given: Array<(n: FGNode) => unknown> = [];
		const graph = {
			graphData: () => undefined,
			width: () => ({ height: () => undefined }),
			nodeThreeObject: (fn: (n: FGNode) => unknown) => given.push(fn),
		};
		const shape = (n: FGNode) => n.id;
		const r = threeRenderer(graph, shape);
		r.rebuildNodes();
		r.rebuildNodes();
		expect(given).toHaveLength(2);
		expect(given[0]).not.toBe(given[1]);
		expect(given[1](nodes([["a", 0, 0, 0]])[0])).toBe("a"); // and it still calls the scene's own factory
	});

	it("takes the size the scene gives it, which is how a medium with no window is still drawn to a size", () => {
		const r = new RecordingRenderer();
		r.size(800, 600);
		expect(r.sized).toEqual({ width: 800, height: 600 });
	});

	it("a composite drives every medium from the scene's one draw, so they cannot drift", () => {
		const a = new RecordingRenderer();
		const b = new RecordingRenderer();
		const c = compositeRenderer(a, b);
		c.size(800, 600);
		c.draw({ nodes: nodes([["a", 1, 2, 3]]), links: [] });
		c.rebuildNodes();
		for (const m of [a, b]) {
			expect(m.sized).toEqual({ width: 800, height: 600 });
			expect(m.placements).toHaveLength(1);
			expect(m.rebuilds).toEqual([1]);
		}
	});

	it("describes a drawn graph in one sentence with per-type counts: the text every medium shares", () => {
		expect(graphSummary({ nodes: nodes([["a", 0, 0, 0]]), links: [] })).toBe("1 nodes (1 Comment) and 0 links");
		expect(graphSummary({ nodes: [], links: [] })).toBe("0 nodes and 0 links");
	});
});
