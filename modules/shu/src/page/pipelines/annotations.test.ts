/** The notes anchored in a record: parsed from the site's annotations step, or walked from the quads the page holds. */
import { describe, expect, it } from "vitest";
import { matchesQuadPattern, type TQuad } from "@haibun/core/lib/quad-types.js";
import { BODY_LABEL, COMMENT_LABEL, LinkRelations, SPECIFIC_RESOURCE_LABEL, TEXT_QUOTE_SELECTOR_LABEL } from "@haibun/core/lib/domains/resources.js";
import { annotationsHeld, annotationsOnSite, type TAnnotationScope } from "./annotations.js";

const quad = (namedGraph: string, subject: string, predicate: string, object: string, objectType?: string): TQuad => ({
	namedGraph,
	subject,
	predicate,
	object,
	timestamp: 1,
	...(objectType === undefined ? {} : { objectType }),
});

/** A note on the record `m-1`: its SpecificResource, selector, Comment and body, and a link to a second section. */
const HELD: TQuad[] = [
	quad(SPECIFIC_RESOURCE_LABEL, "sr-1", LinkRelations.HAS_SOURCE.rel, "m-1", "Email"),
	quad(SPECIFIC_RESOURCE_LABEL, "sr-1", LinkRelations.HAS_SELECTOR.rel, "sel-1", TEXT_QUOTE_SELECTOR_LABEL),
	quad(TEXT_QUOTE_SELECTOR_LABEL, "sel-1", LinkRelations.EXACT.rel, "a passage"),
	quad(TEXT_QUOTE_SELECTOR_LABEL, "sel-1", LinkRelations.PREFIX.rel, "before "),
	quad(COMMENT_LABEL, "c-1", LinkRelations.TARGET.rel, "sr-1", SPECIFIC_RESOURCE_LABEL),
	quad(COMMENT_LABEL, "c-1", LinkRelations.ATTRIBUTED_TO.rel, "did:example:reader"),
	quad(COMMENT_LABEL, "c-1", LinkRelations.HAS_BODY.rel, "b-1", BODY_LABEL),
	quad(BODY_LABEL, "b-1", LinkRelations.CONTENT.rel, "a *note*"),
	quad(COMMENT_LABEL, "c-1", LinkRelations.LINKS_TO.rel, "sr-2", SPECIFIC_RESOURCE_LABEL),
	quad(SPECIFIC_RESOURCE_LABEL, "sr-2", LinkRelations.HAS_SOURCE.rel, "m-2", "Email"),
	quad(SPECIFIC_RESOURCE_LABEL, "sr-2", LinkRelations.HAS_SELECTOR.rel, "sel-2", TEXT_QUOTE_SELECTOR_LABEL),
	quad(TEXT_QUOTE_SELECTOR_LABEL, "sel-2", LinkRelations.EXACT.rel, "another section"),
];

const holding = (quads: TQuad[], call: TAnnotationScope["call"]): TAnnotationScope => ({
	call,
	quads: (pattern) => Promise.resolve(quads.filter((q) => matchesQuadPattern(q, pattern))),
});
const refusing: TAnnotationScope["call"] = () => Promise.resolve({ ok: false, refusal: { error: "the site refuses" } });

describe("the notes anchored in a record", () => {
	it("walks the quads the page holds to each note on the record, with its quote, author, body and linked sections", async () => {
		expect(await annotationsHeld(holding(HELD, refusing), "m-1")).toEqual([
			{
				commentId: "c-1",
				specificResourceId: "sr-1",
				exact: "a passage",
				prefix: "before ",
				author: "did:example:reader",
				body: "a *note*",
				links: [{ exact: "another section" }],
			},
		]);
		expect(await annotationsHeld(holding(HELD, refusing), "m-3")).toEqual([]);
	});

	it("parses the site's notes, and returns the site's refusal", async () => {
		const note = { commentId: "c-1", specificResourceId: "sr-1", exact: "a passage" };
		const site: TAnnotationScope["call"] = <T>() => Promise.resolve({ ok: true as const, value: { annotations: [note], total: 1 } as T });
		expect(await annotationsOnSite(holding([], site), "Email", "m-1")).toEqual({ ok: true, value: [note] });
		expect(await annotationsOnSite(holding([], refusing), "Email", "m-1")).toEqual({ ok: false, refusal: { error: "the site refuses" } });
	});

	it("refuses a site's notes that don't match the annotations step's products", async () => {
		const malformed: TAnnotationScope["call"] = <T>() => Promise.resolve({ ok: true as const, value: { annotations: [{ exact: "a passage" }] } as T });
		await expect(annotationsOnSite(holding([], malformed), "Email", "m-1")).rejects.toThrow();
	});
});
