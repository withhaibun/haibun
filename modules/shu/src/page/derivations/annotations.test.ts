import { describe, it, expect } from "vitest";
import { itemAt } from "@haibun/core/lib/domains/item-at.js";
import type { TAnnotationView } from "@haibun/core/lib/domains/resources.js";
import { notesIn, toW3CAnnotations } from "./annotations.js";
import { alignTexts, renderedQuote } from "./text-alignment.js";
import type { TQuoteAnchor } from "@haibun/core/lib/domains/resources.js";

/** Places a quote in `text`, a text that renders as itself. */
const placedIn = (text: string) => (quote: TQuoteAnchor) => renderedQuote(alignTexts(text, text), quote);

const view = (over: Partial<TAnnotationView>): TAnnotationView => ({
	commentId: "c1",
	specificResourceId: "sr1",
	exact: "the quote",
	source: "b1",
	sourceDigest: "digest-1",
	...over,
});

describe("toW3CAnnotations, anchoring shape for the annotator library", () => {
	it("emits BOTH a TextQuoteSelector and a computed TextPositionSelector (the library requires both to anchor)", () => {
		const text = "Anyone up for hiking this weekend?";
		const a = itemAt(toW3CAnnotations([view({ exact: "hiking this weekend", body: "note" })], "urn:msg", placedIn(text)), 0);
		expect(a.target.source).toBe("urn:msg");
		const [quote, position] = a.target.selector;
		expect(quote).toEqual({ type: "TextQuoteSelector", exact: "hiking this weekend" });
		expect(position).toEqual({ type: "TextPositionSelector", start: text.indexOf("hiking this weekend"), end: text.indexOf("hiking this weekend") + "hiking this weekend".length });
		expect(a.body).toEqual([{ type: "TextualBody", value: "note", format: "text/markdown" }]);
	});

	it("omits an annotation whose quote is absent from the rendered text: it cannot be highlighted, only listed", () => {
		expect(toW3CAnnotations([view({ exact: "not present here" })], "urn:msg", placedIn("some other text"))).toEqual([]);
	});

	it("uses prefix/suffix to disambiguate a repeated quote to the intended occurrence", () => {
		const text = "pay the fee. later, pay the fee again.";
		const a = itemAt(toW3CAnnotations([view({ exact: "pay the fee", prefix: "later, " })], "urn:msg", placedIn(text)), 0);
		expect(a.target.selector[1]).toEqual({
			type: "TextPositionSelector",
			start: text.indexOf("later, ") + "later, ".length,
			end: text.indexOf("later, ") + "later, ".length + "pay the fee".length,
		});
	});

	it("carries prefix/suffix on the quote selector when present", () => {
		const a = itemAt(toW3CAnnotations([view({ exact: "fee", prefix: "the ", suffix: "." })], "urn:msg", placedIn("the fee.")), 0);
		expect(a.target.selector[0]).toEqual({ type: "TextQuoteSelector", exact: "fee", prefix: "the ", suffix: "." });
	});
});

describe("notesIn, the notes of the Body a view shows", () => {
	const note = (commentId: string, source: string, sourceDigest: string): TAnnotationView => ({
		commentId,
		specificResourceId: `sr-${commentId}`,
		exact: "a passage",
		source,
		sourceDigest,
	});

	it("holds a note on the Body as it reads current, a note on an earlier text of it stale, and leaves out a note on another Body", () => {
		const shown = { id: "b-1", digest: "now" };
		const { current, stale } = notesIn([note("c-1", "b-1", "now"), note("c-2", "b-1", "before"), note("c-3", "b-2", "now")], shown);
		expect(current.map(({ commentId }) => commentId)).toEqual(["c-1"]);
		expect(
			stale.map(({ commentId }) => commentId),
			"the Body changed after the note quoted it",
		).toEqual(["c-2"]);
	});
});
