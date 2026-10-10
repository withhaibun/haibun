import { describe, it, expect } from "vitest";
import { declareSpec } from "./test/catalog-fixture.js";
import { extractBodyLiterals, extractFieldEntries, idOf, instanceLabel, isReferenceEdge, isVisibleKey, pickPreferredBody, SPA_PROPS } from "./util.js";
import { STORED_TYPE_PROP } from "./domains/elements.js";

/** A type whose id and title field names don't match another type's fields. Only its declaration resolves them. */
const CONCEPT = { type: "Concept", idField: "conceptId", titleField: "title" } as const;

// Seed the rels cache so isVisibleKey can resolve property → rel for known labels.
declareSpec({
	types: ["Email", "SeqPath", CONCEPT.type],
	idFields: { Email: "messageId", SeqPath: "id", [CONCEPT.type]: CONCEPT.idField },
	rels: {
		Email: {
			messageId: "identifier",
			subject: "name",
			from: "attributedTo",
			to: "audience",
			folder: "groupedAs",
			account: "groupedAs",
			body: "content",
			bodyHtml: "content",
			bodyMarkdown: "content",
			accessLevel: "accessLevel",
		},
		// A SeqPath's stepText carries the `content` rel (body presentation): the literal-body case extractBodyLiterals covers.
		SeqPath: { id: "identifier", stepText: "content", actionStatus: "actionStatus", generatedAtTime: "generatedAtTime" },
		[CONCEPT.type]: { [CONCEPT.idField]: "identifier", [CONCEPT.titleField]: "name" },
	},
	edgeRanges: { Email: { hasBody: ["Body"], inReplyTo: ["Email"] } },
	queryable: { Email: ["subject", "from", "folder"] },
	validTimeFields: { Email: "dateReceived" },
	ui: {},
	titledBy: { [CONCEPT.type]: { key: CONCEPT.titleField, through: false } },
});

describe("a record's id and title", () => {
	const concept = { "@type": CONCEPT.type, [CONCEPT.idField]: "c-1", [CONCEPT.titleField]: "Watershed" };

	it("resolves both from the fields its type declares", () => {
		expect(idOf(concept)).toBe("c-1");
		expect(instanceLabel(concept)).toBe("Watershed");
	});

	it("reads the id from the record's @id where it carries one", () => {
		expect(idOf({ ...concept, "@id": "ex:concept/c-2" })).toBe("c-2");
	});

	it("rejects a record that doesn't carry an @id or its declared id field", () => {
		expect(() => idOf({ "@type": CONCEPT.type, [CONCEPT.titleField]: "Watershed" })).toThrow(CONCEPT.idField);
	});
});

describe("isVisibleKey", () => {
	it("hides projection-internal keys (`_*`, `@*`)", () => {
		expect(isVisibleKey("_label")).toBe(false);
		expect(isVisibleKey("@id")).toBe(false);
		expect(isVisibleKey("@type")).toBe(false);
	});

	it("hides SPA artifacts", () => {
		expect(SPA_PROPS.has(STORED_TYPE_PROP)).toBe(true);
		expect(isVisibleKey(STORED_TYPE_PROP)).toBe(false);
	});

	it("hides keys whose name is itself a body-presentation rel (covers inlined edges like hasBody)", () => {
		expect(isVisibleKey("hasBody")).toBe(false);
		expect(isVisibleKey("hasBody", "Email")).toBe(false);
	});

	it("hides keys whose name is itself a governance-presentation rel (covers inlined accessLevel)", () => {
		expect(isVisibleKey("accessLevel")).toBe(false);
		expect(isVisibleKey("accessLevel", "Email")).toBe(false);
	});

	it("hides label-rels with body presentation (Email's body field carries the `content` rel)", () => {
		expect(isVisibleKey("body", "Email")).toBe(false);
		expect(isVisibleKey("bodyHtml", "Email")).toBe(false);
		expect(isVisibleKey("bodyMarkdown", "Email")).toBe(false);
	});

	it("shows ordinary domain fields (subject, from)", () => {
		expect(isVisibleKey("subject", "Email")).toBe(true);
		expect(isVisibleKey("from", "Email")).toBe(true);
	});

	it("shows unknown keys when label is unknown, fail open, not closed", () => {
		expect(isVisibleKey("subject")).toBe(true);
		expect(isVisibleKey("subject", "UnknownLabel")).toBe(true);
	});
});

describe("isReferenceEdge", () => {
	it("excludes body-presentation edges (hasBody)", () => {
		expect(isReferenceEdge("hasBody")).toBe(false);
	});

	it("excludes governance-presentation edges (accessLevel)", () => {
		expect(isReferenceEdge("accessLevel")).toBe(false);
	});

	it("includes ordinary navigational edges (inReplyTo, attachment)", () => {
		expect(isReferenceEdge("inReplyTo")).toBe(true);
		expect(isReferenceEdge("attachment")).toBe(true);
	});
});

describe("extractFieldEntries", () => {
	const emailWithInlinedBodies = {
		"@id": "ex:email/abc",
		"@type": "Email",
		_label: "Email",
		messageId: "abc@example.com",
		subject: "Re: tia test",
		from: "reader@example.com",
		to: ["dev@example.com"],
		folder: "INBOX",
		account: "work",
		accessLevel: "private",
		seqPath: "0.1.2.26.1",
		hasBody: [{ "@id": "ex:body/body-abc-default-text-plain", "@type": "Body", id: "body-abc-default-text-plain", content: "moocoo", mediaType: "text/plain" }],
	};

	it("does NOT include hasBody as a field entry, even when it leaks back as a string", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.hasBody).toBeUndefined();
	});

	it("does NOT include hasBody when stored as a bare string id (the user-reported regression)", () => {
		const cursed = { ...emailWithInlinedBodies, hasBody: "body-abc-default-text-plain" };
		const fields = extractFieldEntries(cursed, "Email");
		expect(fields.hasBody).toBeUndefined();
	});

	it("does NOT include accessLevel, governance bucket is rendered elsewhere", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.accessLevel).toBeUndefined();
	});

	it("does NOT include body / bodyHtml / bodyMarkdown, content rels render in the iframe", () => {
		const cursed = { ...emailWithInlinedBodies, body: "plain text", bodyHtml: "<p>html</p>", bodyMarkdown: "*md*" };
		const fields = extractFieldEntries(cursed, "Email");
		expect(fields.body).toBeUndefined();
		expect(fields.bodyHtml).toBeUndefined();
		expect(fields.bodyMarkdown).toBeUndefined();
	});

	it("does NOT include vertexLabel, _label, @id, @type", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.vertexLabel).toBeUndefined();
		expect(fields._label).toBeUndefined();
		expect(fields["@id"]).toBeUndefined();
		expect(fields["@type"]).toBeUndefined();
	});

	it("DOES include subject, from, folder, account, seqPath", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.subject).toBe("Re: tia test");
		expect(fields.from).toBe("reader@example.com");
		expect(fields.folder).toBe("INBOX");
		expect(fields.account).toBe("work");
		expect(fields.seqPath).toBe("0.1.2.26.1");
	});

	it("turns a string array into an array of strings", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.to).toEqual(["dev@example.com"]);
	});
});

describe("extractBodyLiterals", () => {
	it("extracts a literal body-presentation field via its label rel (a SeqPath's stepText → content)", () => {
		const seq = { id: "0.1.2", stepText: "create widget {widget}", actionStatus: "passed" };
		expect(extractBodyLiterals(seq, "SeqPath")).toEqual({ stepText: "create widget {widget}" });
	});

	it("extracts a field whose NAME is itself a body rel (content), even without a label", () => {
		expect(extractBodyLiterals({ content: "inline text" })).toEqual({ content: "inline text" });
	});

	it("excludes ordinary fields, summary/governance rels, and linked hasBody arrays", () => {
		const email = { subject: "hi", accessLevel: "private", hasBody: [{ id: "b", content: "c", mediaType: "text/plain" }] };
		expect(extractBodyLiterals(email, "Email")).toEqual({});
	});

	it("excludes projection-internal keys and empty values", () => {
		expect(extractBodyLiterals({ _x: "a", "@id": "b", stepText: "" }, "SeqPath")).toEqual({});
	});
});

describe("pickPreferredBody", () => {
	const plain = { mediaType: "text/plain", content: "plain text" };
	const md = { mediaType: "text/markdown", content: "*md*" };
	const html = { mediaType: "text/html", content: "<p>html</p>" };

	it("prefers text/markdown when present", () => {
		expect(pickPreferredBody([plain, md, html])).toBe(md);
		expect(pickPreferredBody([html, md])).toBe(md);
	});

	it("falls back to text/plain when the bodies don't include markdown", () => {
		expect(pickPreferredBody([plain, html])).toBe(plain);
	});

	it("falls back to text/html when the bodies don't include markdown or plain", () => {
		expect(pickPreferredBody([html])).toBe(html);
	});

	it("returns the first usable when the preferred types don't match", () => {
		const ical = { mediaType: "text/calendar", content: "BEGIN:VCALENDAR" };
		expect(pickPreferredBody([ical])).toBe(ical);
	});

	it("skips a body known to be empty, and a body that doesn't state a media type", () => {
		expect(pickPreferredBody([{ mediaType: "text/markdown", content: "" }, plain])).toBe(plain);
		expect(pickPreferredBody([{ content: "no media type" }, md])).toBe(md);
	});

	it("chooses from a listing that names bodies without their text, by media type", () => {
		const listed = [
			{ id: "p", mediaType: "text/plain" },
			{ id: "h", mediaType: "text/html" },
			{ id: "m", mediaType: "text/markdown" },
		];
		expect(pickPreferredBody(listed)?.id).toBe("m");
	});

	it("returns undefined for empty input", () => {
		expect(pickPreferredBody([])).toBeUndefined();
	});
});
