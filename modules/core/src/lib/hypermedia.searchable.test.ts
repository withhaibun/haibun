/**
 * Which fields of a type a text search reads.
 *
 * A reader names part of a value and expects the records carrying it. Read from two rels alone, a type addressed by a
 * string reached no primitive: its address is not a bounded value, so no filter compares it, and it carried neither of
 * the two rels a search read. Every text property a type declares is read instead, and the fields stating when a record
 * was made, where it sits and who may read it are left out.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { LinkRelations, type THypermediaTopology } from "./resources.js";
import { searchableFields, queryableFields } from "./hypermedia.js";

const PersonSchema = z.object({ email: z.string(), name: z.string().optional(), generatedAtTime: z.date() });
const personTopology: THypermediaTopology = {
	persistedAs: "Person",
	id: "email",
	properties: { email: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
};
const person = { schema: PersonSchema, topology: personTopology };

describe("the fields a text search reads", () => {
	it("reads the text properties naming what a record is, and leaves its identifier for a read that holds it", () => {
		// A type's identifier holds a handle a reader knows, such as an address, and a handle a run generated, such as a
		// comment's own id. A search reading both answered a question with the asking run's own records; a type states
		// which of the two it holds nowhere, so neither is read.
		expect(searchableFields(person)).toEqual(["name"]);
	});

	it("reads fields a filter doesn't, since a filter compares bounded values", () => {
		const schema = z.object({ messageId: z.string(), folder: z.string(), unread: z.boolean() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			id: "messageId",
			properties: { messageId: LinkRelations.IDENTIFIER.rel, folder: LinkRelations.CONTEXT.rel, unread: LinkRelations.TAG.rel },
		};
		// A folder is text a reader names and a flag is a value they compare, so the two surfaces answer different reads.
		expect(searchableFields({ schema, topology })).toEqual(["folder"]);
		expect(queryableFields({ schema, topology })).toContain("unread");
	});

	it("leaves out when a record was made, where it sits, who may read it, and what its text is written in", () => {
		const schema = z.object({ title: z.string(), seqPath: z.string(), accessLevel: z.string(), startedAtTime: z.string(), mediaType: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Note",
			id: "title",
			properties: {
				title: LinkRelations.NAME.rel,
				seqPath: LinkRelations.SEQ_PATH.rel,
				accessLevel: LinkRelations.ACCESS_LEVEL.rel,
				startedAtTime: LinkRelations.STARTED_AT_TIME.rel,
				mediaType: LinkRelations.MEDIA_TYPE.rel,
			},
		};
		// Each of these holds a string, so a rule reading the schema's type alone would read every one of them, and a
		// search naming a level or a media type every record carries would answer with every record. Each names its own
		// rel, so a rule listing the rels it leaves out is a list a rel added later is absent from.
		expect(searchableFields({ schema, topology })).toEqual(["title"]);
	});

	it("leaves out a value that is nothing but a value, whatever it holds", () => {
		// `tag` is the rel for a count, a flag, a duration or an error string: it says a record carries something and no
		// more, so naming its value names no record in particular.
		const schema = z.object({ subject: z.string(), unread: z.boolean(), size: z.number(), state: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			id: "subject",
			properties: { subject: LinkRelations.NAME.rel, unread: LinkRelations.TAG.rel, size: LinkRelations.TAG.rel, state: LinkRelations.TAG.rel },
		};
		expect(searchableFields({ schema, topology })).toEqual(["subject"]);
	});

	it("reads who a record involves and where it sits in a reader's own terms", () => {
		const schema = z.object({ messageId: z.string(), from: z.string(), to: z.string(), folder: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			id: "messageId",
			properties: {
				messageId: LinkRelations.IDENTIFIER.rel,
				from: LinkRelations.ATTRIBUTED_TO.rel,
				to: LinkRelations.AUDIENCE.rel,
				folder: LinkRelations.CONTEXT.rel,
			},
		};
		expect(searchableFields({ schema, topology })).toEqual(["folder", "from", "to"]);
	});

	it("reads a content property, which a type declares with the media type its text is in", () => {
		const schema = z.object({ id: z.string(), body: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Note",
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/plain" } },
		};
		expect(searchableFields({ schema, topology })).toEqual(["body"]);
	});
});
