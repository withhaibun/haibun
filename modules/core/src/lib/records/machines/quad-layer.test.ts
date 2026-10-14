/**
 * A layer's reads of a subject, a predicate and a graph read only those quads, through the layer's indexes (PF23).
 */
import { describe, expect, it } from "vitest";
import { QuadLayer } from "./quad-layer.js";
import type { TQuad } from "../../steps/domains/quad-types.js";

const quad = (namedGraph: string, subject: string, predicate: string, object: unknown): TQuad => ({ namedGraph, subject, predicate, object, timestamp: 0 });

/** A layer that holds 10,000 quads of other subjects and predicates beside the quads a test reads. */
function crowded(): QuadLayer {
	const layer = new QuadLayer();
	for (let i = 0; i < 10_000; i++) layer.add(quad(`Graph${i % 7}`, `other-${i}`, `field${i % 13}`, i));
	return layer;
}

describe("the candidates a pattern reads", () => {
	it("are the quads of a subject in every graph, where the pattern names only the subject", () => {
		const layer = crowded();
		const held = [quad("Letter", "s", "subject", "a"), quad("Person", "s", "name", "b")];
		for (const q of held) layer.add(q);
		expect([...layer.candidates({ subject: "s" })]).toEqual(held);
	});

	it("are the quads of a predicate, where the pattern names only the predicate", () => {
		const layer = crowded();
		const held = [quad("Letter", "a", "rare", 1), quad("Person", "b", "rare", 2)];
		for (const q of held) layer.add(q);
		expect([...layer.candidates({ predicate: "rare" })]).toEqual(held);
	});

	it("are the smaller of a graph's quads and a predicate's quads, where the pattern names both", () => {
		const layer = crowded();
		layer.add(quad("Graph1", "a", "rare", 1));
		expect([...layer.candidates({ namedGraph: "Graph1", predicate: "rare" })]).toEqual([quad("Graph1", "a", "rare", 1)]);
	});

	it("leave a removed quad out of every index", () => {
		const layer = new QuadLayer();
		const held = quad("Letter", "s", "subject", "a");
		layer.add(held);
		layer.delete(held);
		expect([layer.candidates({ subject: "s" }).size, layer.candidates({ predicate: "subject" }).size, layer.candidates({ namedGraph: "Letter" }).size]).toEqual([0, 0, 0]);
	});
});
