/**
 * A graph states what it draws to a model through a window, and a reader's graph is any size. What the summary holds,
 * and what it says about the rest, is the scene's answer to that.
 */
import { describe, expect, it } from "vitest";
import { GRAPH_SUMMARY_STATEMENTS, heldForKihan } from "./polymorphic-summary.js";

const stated = (subject: string, object: string) => ({ subject, predicate: "inReplyTo", object, namedGraph: "Email" });
const aGraph = (count: number, about = "other") => ({
	"@id": "view:graph",
	"@type": "as:Collection",
	name: "visible graph",
	totalItems: count,
	quads: Array.from({ length: count }, (_, at) => stated(`${about}-${at}@bakery.test`, `${about}-${at + 1}@bakery.test`)),
});

describe("what a graph states to a reader who is not looking at it", () => {
	it("states every statement it draws, where a summary holds them all", () => {
		const whole = aGraph(3);
		expect(heldForKihan(whole, null)).toBe(whole);
	});

	it("keeps the statements about the node the reader is on, before the ones about anything else", () => {
		const on = "read-me@bakery.test";
		const whole = aGraph(GRAPH_SUMMARY_STATEMENTS + 10);
		whole.quads.push(stated(on, "elsewhere@bakery.test"), stated("elsewhere@bakery.test", on));
		const held = heldForKihan(whole, on).quads as Array<{ subject: string; object: string }>;
		expect(held.slice(0, 2), "the reader's own node first").toEqual([stated(on, "elsewhere@bakery.test"), stated("elsewhere@bakery.test", on)]);
		expect(held, "and what a summary holds, no more").toHaveLength(GRAPH_SUMMARY_STATEMENTS);
	});

	it("says how many statements it holds and names the step that reads them all, so a reader asks for the rest", () => {
		const whole = aGraph(1_200);
		const summary = heldForKihan(whole, null, 200);
		expect(summary.statementsHeld).toBe(200);
		expect(summary.totalItems, "the count is of the graph, not of what the summary holds").toBe(1_200);
		expect(summary.readTheRestWith).toMatchObject({ method: "GraphSourceStepper-getClusteredQuads", params: { perTypeLimit: 1_200 } });
	});

	it("holds the statements the view drew first, where the reader is on nothing", () => {
		const held = heldForKihan(aGraph(50), null, 10).quads as Array<{ subject: string }>;
		expect(held.map((q) => q.subject)).toEqual(Array.from({ length: 10 }, (_, at) => `other-${at}@bakery.test`));
	});
});
