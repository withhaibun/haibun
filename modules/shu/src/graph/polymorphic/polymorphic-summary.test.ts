/**
 * A graph states itself to a reader who is not looking at it. Which statements come first is the scene's to say, since
 * it is the only thing that knows what the reader is on; how many of them travel, and how many a window holds, are
 * decided after this and keep what arrives first.
 */
import { describe, expect, it } from "vitest";
import { readsEveryStatement, statedAboutFirst } from "./polymorphic-summary.js";
import { RPC_METHOD } from "../../consts.js";

const subjectAt = (at: number) => `note-${at}@bakery.test`;
const stated = (subject: string, object: string) => ({ subject, predicate: "inReplyTo", object, namedGraph: "Email" });
const drew = (count: number) => Array.from({ length: count }, (_, at) => stated(subjectAt(at), subjectAt(at + 1)));

describe("the order a graph states itself in", () => {
	it("states what the reader is on first, whether the graph names it as the subject or as the object", () => {
		const on = "read-me@bakery.test";
		const drawn = [stated(subjectAt(0), subjectAt(1)), stated(on, subjectAt(2)), stated(subjectAt(3), on)];
		expect(statedAboutFirst(drawn, on)).toEqual([drawn[1], drawn[2], drawn[0]]);
	});

	it("keeps the order the view drew, for a reader on nothing, and every statement either way", () => {
		const drawn = drew(50);
		expect(statedAboutFirst(drawn, null)).toEqual(drawn);
		expect(statedAboutFirst(drawn, "read-me@bakery.test"), "a node the graph does not state leaves the order as it was").toEqual(drawn);
	});
});

describe("the call that reads every statement", () => {
	it("is a read of the graph as the view read it, so a reader carrying part of it asks for the rest", () => {
		expect(readsEveryStatement({ perTypeLimit: 100, accessLevel: "private" })).toEqual({
			method: RPC_METHOD.CLUSTERED_QUADS,
			params: { perTypeLimit: 100, accessLevel: "private" },
			summary: "every statement this graph draws",
			asks: "read",
		});
	});
});
