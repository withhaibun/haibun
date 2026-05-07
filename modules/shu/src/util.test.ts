import { describe, it, expect } from "vitest";
import { extractFieldEntries, isReferenceEdge, isVisibleKey, pickPreferredBody, SPA_PROPS } from "./util.js";
import { setSiteMetadata } from "./rels-cache.js";

// Seed the rels cache so isVisibleKey can resolve property → rel for known labels.
setSiteMetadata({
	types: ["Email"],
	idFields: { Email: "messageId" },
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
	},
	edgeRanges: { Email: { hasBody: "Body", inReplyTo: "Email" } },
	properties: { Email: ["messageId", "subject", "from", "to", "folder", "account", "body", "bodyHtml", "bodyMarkdown", "accessLevel"] },
	summary: { Email: ["subject"] },
	ui: {},
	propertyDefinitions: {
		hasBody: { iri: "oa:hasBody", range: "iri", presentation: "body" },
		content: { iri: "as:content", range: "literal", presentation: "body" },
		accessLevel: { iri: "hbn:accessLevel", range: "literal", presentation: "governance" },
		name: { iri: "as:name", range: "literal", presentation: "summary" },
		identifier: { iri: "dcterms:identifier", range: "iri" },
		attributedTo: { iri: "as:attributedTo", range: "iri" },
		audience: { iri: "as:to", range: "iri" },
		groupedAs: { iri: "as:context", range: "container" },
		inReplyTo: { iri: "as:inReplyTo", range: "iri" },
		wasInformedBy: { iri: "prov:wasInformedBy", range: "iri", subPropertyOf: "inReplyTo" },
	},
});

describe("isVisibleKey", () => {
	it("hides projection-internal keys (`_*`, `@*`)", () => {
		expect(isVisibleKey("_label")).toBe(false);
		expect(isVisibleKey("@id")).toBe(false);
		expect(isVisibleKey("@type")).toBe(false);
	});

	it("hides SPA artifacts", () => {
		expect(SPA_PROPS.has("vertexLabel")).toBe(true);
		expect(isVisibleKey("vertexLabel")).toBe(false);
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

	it("shows unknown keys when label is unknown — fail open, not closed", () => {
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
		"@id": "muskeg:email/abc",
		"@type": "Email",
		_label: "Email",
		messageId: "abc@example.com",
		subject: "Re: tia test",
		from: "tiame@zooid.org",
		to: ["dev@example.com"],
		folder: "INBOX",
		account: "zooid",
		accessLevel: "private",
		seqPath: "0.1.2.26.1",
		hasBody: [
			{ "@id": "muskeg:body/body-abc-default-text-plain", "@type": "Body", id: "body-abc-default-text-plain", content: "moocoo", mediaType: "text/plain" },
		],
	};

	it("does NOT include hasBody as a field entry — even when it leaks back as a string", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.hasBody).toBeUndefined();
	});

	it("does NOT include hasBody when stored as a bare string id (the user-reported regression)", () => {
		const cursed = { ...emailWithInlinedBodies, hasBody: "body-abc-default-text-plain" };
		const fields = extractFieldEntries(cursed, "Email");
		expect(fields.hasBody).toBeUndefined();
	});

	it("does NOT include accessLevel — governance bucket is rendered elsewhere", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.accessLevel).toBeUndefined();
	});

	it("does NOT include body / bodyHtml / bodyMarkdown — content rels render in the iframe", () => {
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
		expect(fields.from).toBe("tiame@zooid.org");
		expect(fields.folder).toBe("INBOX");
		expect(fields.account).toBe("zooid");
		expect(fields.seqPath).toBe("0.1.2.26.1");
	});

	it("turns a string array into an array of strings", () => {
		const fields = extractFieldEntries(emailWithInlinedBodies, "Email");
		expect(fields.to).toEqual(["dev@example.com"]);
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

	it("falls back to text/plain when no markdown", () => {
		expect(pickPreferredBody([plain, html])).toBe(plain);
	});

	it("falls back to text/html when no markdown or plain", () => {
		expect(pickPreferredBody([html])).toBe(html);
	});

	it("returns the first usable when no preferred type matches", () => {
		const ical = { mediaType: "text/calendar", content: "BEGIN:VCALENDAR" };
		expect(pickPreferredBody([ical])).toBe(ical);
	});

	it("skips bodies missing content or mediaType", () => {
		expect(pickPreferredBody([{ mediaType: "text/markdown", content: "" }, plain])).toBe(plain);
		expect(pickPreferredBody([{ content: "no media type" }, md])).toBe(md);
	});

	it("returns undefined for empty input", () => {
		expect(pickPreferredBody([])).toBeUndefined();
	});
});
