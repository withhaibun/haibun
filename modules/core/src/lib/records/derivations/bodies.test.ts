import { describe, expect, it } from "vitest";
import { LinkRelations } from "../../resources.js";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { bodyIdOf, bodyKindsOf, bodyOfForms, DEFAULT_BODY_KIND, formIn, preferredMediaType, preferredReading, readingKey, readingsOf, withBodiesRead } from "./bodies.js";

const CONTENT = LinkRelations.CONTENT.rel;
const plain = { mediaType: MEDIA_TYPE.plain, content: "plain text" };
const markdown = { mediaType: MEDIA_TYPE.markdown, content: "*md*" };
const html = { mediaType: MEDIA_TYPE.html, content: "<p>html</p>" };

describe("a Body's text, chosen among its forms", () => {
	it("is the markdown where a write holds it, then the plain text, then the HTML, with each other form a representation", () => {
		expect(bodyOfForms([plain, html, markdown], "an email's Body")).toEqual({ ...markdown, representations: [plain, html] });
		expect(bodyOfForms([html, plain], "an email's Body")).toEqual({ ...plain, representations: [html] });
		expect(bodyOfForms([html], "an email's Body")).toEqual(html);
	});

	it("is the one form of a Body of one form, whatever its media type", () => {
		expect(preferredMediaType([MEDIA_TYPE.json], "a tool call's parameters")).toBe(MEDIA_TYPE.json);
	});

	it("is refused for a Body without a form, with two forms in one media type, or with several forms one of which BODY_PREFERENCE doesn't order", () => {
		expect(() => preferredMediaType([], "a Body")).toThrow("doesn't hold a form of its text");
		expect(() => preferredMediaType([MEDIA_TYPE.plain, MEDIA_TYPE.plain], "a Body")).toThrow("two forms in one media type");
		expect(() => preferredMediaType([MEDIA_TYPE.plain, MEDIA_TYPE.json], "a Body")).toThrow(`BODY_PREFERENCE doesn't order ${MEDIA_TYPE.json}`);
	});
});

describe("the Bodies a type declares", () => {
	it("are one for each kind, the content fields of a kind holding its forms and a field without a kind holding a form of the record's one Body", () => {
		const kinds = bodyKindsOf("Email", {
			subject: LinkRelations.NAME.rel,
			body: { rel: CONTENT, mediaType: MEDIA_TYPE.plain },
			bodyHtml: { rel: CONTENT, mediaType: MEDIA_TYPE.html },
			result: { rel: CONTENT, mediaType: MEDIA_TYPE.json, kind: "result" },
		});
		expect(Object.fromEntries(kinds)).toEqual({
			[DEFAULT_BODY_KIND]: [
				{ field: "body", mediaType: MEDIA_TYPE.plain },
				{ field: "bodyHtml", mediaType: MEDIA_TYPE.html },
			],
			result: [{ field: "result", mediaType: MEDIA_TYPE.json }],
		});
	});

	it("are refused where one kind holds two texts whose forms BODY_PREFERENCE doesn't order", () => {
		const declared = { params: { rel: CONTENT, mediaType: MEDIA_TYPE.json }, result: { rel: CONTENT, mediaType: MEDIA_TYPE.plain } } as const;
		expect(() => bodyKindsOf("ToolCall", declared)).toThrow(`ToolCall's Body "${DEFAULT_BODY_KIND}" holds the forms`);
	});
});

describe("a Body's id", () => {
	it("names its record, its kind and the media type its kind's declaration prefers, whatever forms one write holds", () => {
		const forms = [
			{ field: "body", mediaType: MEDIA_TYPE.plain },
			{ field: "bodyMarkdown", mediaType: MEDIA_TYPE.markdown },
		];
		expect(bodyIdOf("m-1", DEFAULT_BODY_KIND, forms)).toBe("body-m-1-default-text-markdown");
		expect(bodyIdOf("t-1", "result", [{ field: "result", mediaType: MEDIA_TYPE.json }])).toBe("body-t-1-result-application-json");
	});
});

describe("the readings of the bodies a record links", () => {
	const listed = { id: "e", mediaType: MEDIA_TYPE.markdown, representations: [{ mediaType: MEDIA_TYPE.plain }, { mediaType: MEDIA_TYPE.html }] };

	it("are each form of each body, with its text where the record carries it", () => {
		expect(readingsOf({ hasBody: [listed, { id: "c", ...plain }] })).toEqual([
			{ key: readingKey("e", MEDIA_TYPE.markdown), body: "e", media: MEDIA_TYPE.markdown },
			{ key: readingKey("e", MEDIA_TYPE.plain), body: "e", media: MEDIA_TYPE.plain },
			{ key: readingKey("e", MEDIA_TYPE.html), body: "e", media: MEDIA_TYPE.html },
			{ key: readingKey("c", MEDIA_TYPE.plain), body: "c", media: MEDIA_TYPE.plain, text: plain.content },
		]);
		expect(readingsOf({})).toEqual([]);
	});

	it("refuse a body that doesn't state its media type", () => {
		expect(() => readingsOf({ hasBody: [{ id: "x", content: "no media type" }] })).toThrow();
	});

	it("prefer markdown, then plain text, then HTML, then the first reading with text, leaving out an empty reading", () => {
		const read = (...readings: Array<{ media: string; text?: string }>) => preferredReading(readings)?.media;
		expect(read({ media: MEDIA_TYPE.plain }, { media: MEDIA_TYPE.html }, { media: MEDIA_TYPE.markdown })).toBe(MEDIA_TYPE.markdown);
		expect(read({ media: MEDIA_TYPE.html }, { media: MEDIA_TYPE.plain })).toBe(MEDIA_TYPE.plain);
		expect(read({ media: "text/calendar", text: "BEGIN:VCALENDAR" })).toBe("text/calendar");
		expect(read({ media: MEDIA_TYPE.markdown, text: "" }, { media: MEDIA_TYPE.plain, text: "p" })).toBe(MEDIA_TYPE.plain);
		expect(preferredReading([])).toBeUndefined();
	});

	it("take each body a reader read whole in place of its listing, with the text of each form", () => {
		const read = { id: "e", ...markdown, representations: [plain, html] };
		expect(withBodiesRead({ id: "r", hasBody: [listed, { id: "c", mediaType: MEDIA_TYPE.plain }] }, { e: read })).toEqual({
			id: "r",
			hasBody: [read, { id: "c", mediaType: MEDIA_TYPE.plain }],
		});
	});

	it("select a form of a Body by media type, its text or a representation", () => {
		const read = { id: "e", ...markdown, representations: [plain, html] };
		expect(formIn(read, [MEDIA_TYPE.html])).toBe(html.content);
		expect(formIn(read, [MEDIA_TYPE.json, MEDIA_TYPE.plain])).toBe(plain.content);
		expect(formIn(read, [MEDIA_TYPE.json])).toBeUndefined();
	});
});
