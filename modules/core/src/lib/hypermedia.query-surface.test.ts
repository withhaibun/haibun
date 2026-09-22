/**
 * What a type offers a reader, per property.
 *
 * A primitive reaches some of a type's properties and not others. A reader told nothing asks the primitive they
 * already know and reads its answer as the answer to what they asked: a search that reads no field of a type answers
 * with no match rather than stating that it reads none. This states which primitive reaches each property, from what
 * the type already declares.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LinkRelations, type THypermediaTopology } from "./resources.js";
import { REACHED_BY, querySurface } from "./hypermedia.js";

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
	it("states the relations its records are referenced through, which a reader follows rather than naming a value", () => {
		expect(querySurface(message).references).toEqual(["attachment", "from"]);
	});

	it("states a bounded value as one a filter compares", () => {
		expect(querySurface(message).properties.unread).toEqual([REACHED_BY.filter]);
	});

	it("states text as something a search reads", () => {
		expect(querySurface(message).properties.subject).toEqual([REACHED_BY.search]);
	});

	it("states a property reached both ways as both, so a reader picks rather than guesses", () => {
		// A folder is a value a filter compares and text a reader names, and a reader told only one of those reaches for
		// the other and reads its answer as the whole.
		expect(querySurface(message).properties.folder?.slice().sort()).toEqual([REACHED_BY.filter, REACHED_BY.search]);
	});

	it("states an edge as a property a reader reaches the records through", () => {
		expect(querySurface(message).properties.from).toEqual([REACHED_BY.reference]);
	});

	it("leaves a property no primitive reaches out of what it offers", () => {
		// A type's identifier is held and shown and answers no question a reader asks, which is what naming the surface
		// says rather than leaving a reader to find out by asking.
		expect(querySurface(message).properties.messageId).toBeUndefined();
	});
});
