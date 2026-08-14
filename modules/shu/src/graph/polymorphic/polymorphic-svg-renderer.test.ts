/**
 * The graph as markup, from the same placed nodes every renderer is given.
 *
 * A still is judged the way the WebGL display is: the nodes sit where the layout put them, an edge runs between the
 * nodes its link names, the type colours are the shared vocabulary, and a lane view reads time left to right. Being
 * markup, all of it is asserted as text.
 */
import { describe, expect, it } from "vitest";
import { colorForType } from "../../type-colors.js";
import { SvgRenderer } from "./polymorphic-svg-renderer.js";
import type { FGLink, FGNode } from "./polymorphic-graph-types.js";

const node = (id: string, x: number, y: number, z = 0, type = "Comment"): FGNode => ({ id, name: id, type, x, y, z });
const still = (nodes: FGNode[], links: FGLink[] = [], timeIsHorizontal = false): string => {
	const r = new SvgRenderer({ timeIsHorizontal: () => timeIsHorizontal });
	r.draw({ nodes, links });
	return r.markup;
};

describe("the graph as a still", () => {
	it("places each node where the layout put it, with y flipped since SVG grows downward", () => {
		const markup = still([node("a", 30, 20)]);
		expect(markup).toContain('cx="30" cy="-20"');
		expect(markup).toContain(">a</text>");
	});

	it("colours a node by its type through the shared vocabulary, so a still matches the live view", () => {
		const markup = still([node("a", 0, 0, 0, "Email")]);
		expect(markup).toContain(`fill="${colorForType("Email")}"`);
	});

	it("draws an edge between the nodes its link names, labelled by its predicate", () => {
		const a = node("a", 0, 0);
		const b = node("b", 100, 0);
		const markup = still([a, b], [{ source: a, target: b, predicate: "narrate" }]);
		expect(markup).toContain('x1="0" y1="0" x2="100" y2="0"');
		expect(markup).toContain(">narrate</text>");
	});

	it("throws on a link naming a node that was not drawn, rather than drawing a line to nowhere", () => {
		expect(() => still([node("a", 0, 0)], [{ source: "a", target: "missing", predicate: "narrate" }])).toThrow();
	});

	it("reads time left to right in a lane view, where z carries the calendar", () => {
		const markup = still([node("a", 0, 10, 250)], [], true);
		expect(markup).toContain('cx="250" cy="-10"'); // z is horizontal; the free x is not drawn
	});

	it("escapes a label, since a name is data and markup is code", () => {
		const hostile = { ...node("a", 0, 0), name: '<script>"x"</script>' };
		const markup = still([hostile]);
		expect(markup).not.toContain("<script>");
		expect(markup).toContain("&lt;script&gt;");
	});

	it("is a self-contained document: an svg root with a viewBox covering the drawn extent", () => {
		const markup = still([node("a", -50, 0), node("b", 200, 90)]);
		expect(markup).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="/);
		expect(markup).toContain("</svg>");
		expect(markup).not.toContain("var(--"); // no CSS variables: a still leaves the app
	});

	it("carries its own text alternative: a title and a per-type description, readable without the picture", () => {
		const markup = still([node("a", 0, 0), node("b", 10, 10, 0, "Principal")], [{ source: "a", target: "b", predicate: "attributedTo" }]);
		expect(markup).toContain("<title>graph still</title>");
		expect(markup).toContain("<desc>2 nodes (1 Comment, 1 Principal) and 1 links</desc>");
	});
});
