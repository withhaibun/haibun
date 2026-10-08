/**
 * The primitive that reaches each property of a type.
 *
 * A primitive reaches some of a type's properties and not others. A reader who isn't shown which primitive reaches a
 * property uses the primitive they already know. They read its result as complete. A search that doesn't read a
 * field doesn't return a match for that field. It doesn't state that it skipped the field. querySurface computes the
 * primitive that reaches each property from the type's declaration.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LinkRelations, type THypermediaTopology } from "./resources.js";
import { REACHED_BY, pointsThrough, querySurface } from "./hypermedia.js";

const MessageSchema = z.object({ messageId: z.string(), subject: z.string(), folder: z.string(), unread: z.boolean(), generatedAtTime: z.date() });
const topology: THypermediaTopology = {
	persistedAs: "Message",
	id: "messageId",
	properties: {
		messageId: LinkRelations.IDENTIFIER.rel,
		subject: LinkRelations.NAME.rel,
		folder: LinkRelations.CONTEXT.rel,
		unread: LinkRelations.TAG.rel,
		generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel,
	},
	edges: { from: { range: "Person" }, attachment: { range: "File" } },
};
const message = { schema: MessageSchema, topology };

describe("what a type offers a reader", () => {
	it("states the relations a reference read takes and the type at each relation's other end", () => {
		// A reader names the person and the relation `from` to find the messages that person sent.
		expect(querySurface(message).references).toEqual({ attachment: ["File"], from: ["Person"] });
		expect(pointsThrough(querySurface(message))).toEqual(["attachment (File)", "from (Person)"]);
	});

	it("states every type in a relation's range when the range lists more than one", () => {
		const forwarded = { schema: MessageSchema, topology: { ...topology, edges: { ...topology.edges, from: { range: ["Person", "Mailbox"] } } } };
		expect(querySurface(forwarded).references.from).toEqual(["Person", "Mailbox"]);
		expect(pointsThrough(querySurface(forwarded))).toEqual(["attachment (File)", "from (Person | Mailbox)"]);
	});

	it("states a bounded value as one a filter compares", () => {
		expect(querySurface(message).properties.unread).toEqual([REACHED_BY.filter]);
	});

	it("states a text property as one a search reads", () => {
		expect(querySurface(message).properties.subject).toEqual([REACHED_BY.search]);
	});

	it("states a property reached both ways as both, so a reader picks rather than guesses", () => {
		// A filter compares a folder, and a reader also names a folder in text. A reader shown only one of the two
		// primitives uses it for both reads and takes its result as complete.
		expect(querySurface(message).properties.folder?.slice().sort()).toEqual([REACHED_BY.filter, REACHED_BY.search]);
	});

	it("doesn't state a primitive for a relation, since a relation is read by naming the record at its other end", () => {
		expect(querySurface(message).properties.from).toBeUndefined();
	});

	it("omits a property that a primitive doesn't reach", () => {
		// A type's identifier is held and shown, and a reader can't query it. The query surface omits it, so a reader sees
		// that before trying a query.
		expect(querySurface(message).properties.messageId).toBeUndefined();
	});
});
