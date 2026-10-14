/**
 * The fields of a type that a text search reads.
 *
 * A reader names part of a value and expects the records that contain it. A filter compares bounded values and context
 * facets, and a text search reads text. searchableFields reads each text property whose rel names what a record is
 * about, who it involves or its context. It leaves out every other rel, including the identifier, a record's times, its
 * seqPath, its access level, its media type and `tag`.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Access, LinkRelations, type THypermediaTopology } from "./resources.js";
import { searchableFields, queryableFields } from "./hypermedia.js";

const PersonSchema = z.object({ letter: z.string(), name: z.string().optional(), generatedAtTime: z.date() });
const personTopology: THypermediaTopology = {
	persistedAs: "Person",
	accessLevel: Access.private,
	id: "letter",
	properties: { letter: LinkRelations.IDENTIFIER.rel, name: LinkRelations.NAME.rel, generatedAtTime: LinkRelations.GENERATED_AT_TIME.rel },
};
const person = { schema: PersonSchema, topology: personTopology };

describe("the fields a text search reads", () => {
	it("reads the text properties that name a record, and leaves its identifier to a read by id", () => {
		// A type's identifier holds a handle a reader knows, such as an address, or a handle a run generated, such as a
		// comment's own id. A search that reads generated handles returns records that its own run generated. A type
		// doesn't state which kind of handle its identifier holds, so the search doesn't read identifiers.
		expect(searchableFields(person)).toEqual(["name"]);
	});

	it("reads a text field and leaves a flag to a filter", () => {
		const schema = z.object({ messageId: z.string(), folder: z.string(), unread: z.boolean() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			accessLevel: Access.private,
			id: "messageId",
			properties: { messageId: LinkRelations.IDENTIFIER.rel, folder: LinkRelations.CONTEXT.rel, unread: LinkRelations.TAG.rel },
		};
		// A reader names a folder in text and compares a flag as a value, so search and filter serve different reads.
		expect(searchableFields({ schema, topology })).toEqual(["folder"]);
		expect(queryableFields({ schema, topology })).toContain("unread");
	});

	it("leaves out a record's time, seqPath, access level and media type", () => {
		const schema = z.object({ title: z.string(), seqPath: z.string(), accessLevel: z.string(), startedAtTime: z.string(), mediaType: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Note",
			accessLevel: Access.private,
			id: "title",
			properties: {
				title: LinkRelations.NAME.rel,
				seqPath: LinkRelations.SEQ_PATH.rel,
				accessLevel: LinkRelations.ACCESS_LEVEL.rel,
				startedAtTime: LinkRelations.STARTED_AT_TIME.rel,
				mediaType: LinkRelations.MEDIA_TYPE.rel,
			},
		};
		// Each of these holds a string. A rule that read the schema's type alone would read every one of them. A search
		// for a level or a media type would then match every record that carries it. Each field declares its own rel.
		// searchableFields reads an allowlist of rels, since a list of excluded rels wouldn't contain a rel added later.
		expect(searchableFields({ schema, topology })).toEqual(["title"]);
	});

	it("leaves out a `tag` property, whatever type it holds", () => {
		// `tag` is the rel for a count, a flag, a duration or an error string. It states that a record carries a value and
		// doesn't state more, so a tag's value doesn't identify a particular record.
		const schema = z.object({ subject: z.string(), unread: z.boolean(), size: z.number(), state: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			accessLevel: Access.private,
			id: "subject",
			properties: { subject: LinkRelations.NAME.rel, unread: LinkRelations.TAG.rel, size: LinkRelations.TAG.rel, state: LinkRelations.TAG.rel },
		};
		expect(searchableFields({ schema, topology })).toEqual(["subject"]);
	});

	it("reads the text of a record's attribution, audience and context", () => {
		const schema = z.object({ messageId: z.string(), from: z.string(), to: z.array(z.string()), folder: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Message",
			accessLevel: Access.private,
			id: "messageId",
			properties: { messageId: LinkRelations.IDENTIFIER.rel, from: LinkRelations.ATTRIBUTED_TO.rel, to: LinkRelations.AUDIENCE.rel, folder: LinkRelations.CONTEXT.rel },
		};
		expect(searchableFields({ schema, topology }), "a list of recipients is text, since each recipient is a string").toEqual(["folder", "from", "to"]);
	});

	it("reads a content property that declares the media type of its text", () => {
		const schema = z.object({ id: z.string(), body: z.string() });
		const topology: THypermediaTopology = {
			persistedAs: "Note",
			accessLevel: Access.private,
			id: "id",
			properties: { id: LinkRelations.IDENTIFIER.rel, body: { rel: LinkRelations.CONTENT.rel, mediaType: "text/plain" } },
		};
		expect(searchableFields({ schema, topology })).toEqual(["body"]);
	});
});
