import { describe, expect, it } from "vitest";
import { neighbourhoodOf } from "./neighbourhood.js";

const idOf = (v: Record<string, unknown>): string => (typeof v.id === "string" ? v.id : "");

describe("a record's neighbourhood", () => {
	it("brings the record, each neighbour either way as a node, the edges between them, and pins every record it names", () => {
		const individual = {
			vertex: { id: "e1", subject: "Invoice" },
			edges: [
				{ type: "sender", direction: "out" as const, target: { "@type": "Principal", id: "p1", name: "Vid" } },
				{ type: "replyTo", direction: "in" as const, target: { "@type": "Email", id: "e0" } },
			],
			incomingCount: { total: 1, saturated: false },
		};
		const incoming = { edges: [{ type: "about", direction: "in" as const, target: { "@type": "Note", id: "n1", body: "aside" } }], total: 1, saturated: false };
		const { quads, pinned, types } = neighbourhoodOf("Email", "e1", individual, incoming, idOf, 7);
		expect(quads).toEqual([
			{ subject: "e1", predicate: "subject", object: "Invoice", namedGraph: "Email", timestamp: 7 },
			{ subject: "e1", predicate: "sender", object: "p1", namedGraph: "Email", objectType: "Principal", timestamp: 7 },
			{ subject: "p1", predicate: "name", object: "Vid", namedGraph: "Principal", timestamp: 7 },
			{ subject: "n1", predicate: "about", object: "e1", namedGraph: "Note", objectType: "Email", timestamp: 7 },
			{ subject: "n1", predicate: "body", object: "aside", namedGraph: "Note", timestamp: 7 },
		]);
		expect([...pinned]).toEqual(["e1", "p1", "n1"]);
		expect([...types]).toEqual(["Email", "Principal", "Note"]);
	});

	it("skips an edge whose record lacks a type or an id", () => {
		const individual = { vertex: { id: "e1" }, edges: [{ type: "sender", direction: "out" as const, target: { id: "p1" } }], incomingCount: { total: 0, saturated: false } };
		expect(neighbourhoodOf("Email", "e1", individual, { edges: [], total: 0, saturated: false }, idOf, 7).quads).toEqual([]);
	});
});
