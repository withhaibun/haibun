import { describe, it, expect } from "vitest";
import { toW3CAnnotations, type AnnotationView } from "./annotation-resolver.js";

const view = (over: Partial<AnnotationView>): AnnotationView => ({ commentId: "c1", specificResourceId: "sr1", exact: "the quote", ...over });

describe("toW3CAnnotations — anchoring shape for the annotator library", () => {
	it("emits BOTH a TextQuoteSelector and a computed TextPositionSelector (the library requires both to anchor)", () => {
		const text = "Anyone up for hiking this weekend?";
		const [a] = toW3CAnnotations([view({ exact: "hiking this weekend", body: "note" })], "urn:msg", text);
		expect(a.target.source).toBe("urn:msg");
		const [quote, position] = a.target.selector;
		expect(quote).toEqual({ type: "TextQuoteSelector", exact: "hiking this weekend" });
		expect(position).toEqual({ type: "TextPositionSelector", start: text.indexOf("hiking this weekend"), end: text.indexOf("hiking this weekend") + "hiking this weekend".length });
		expect(a.body).toEqual([{ type: "TextualBody", value: "note", format: "text/markdown" }]);
	});

	it("omits an annotation whose quote is absent from the rendered text — it cannot be highlighted, only listed", () => {
		expect(toW3CAnnotations([view({ exact: "not present here" })], "urn:msg", "some other text")).toEqual([]);
	});

	it("uses prefix/suffix to disambiguate a repeated quote to the intended occurrence", () => {
		const text = "pay the fee. later, pay the fee again.";
		const [a] = toW3CAnnotations([view({ exact: "pay the fee", prefix: "later, " })], "urn:msg", text);
		expect(a.target.selector[1]).toEqual({
			type: "TextPositionSelector",
			start: text.indexOf("later, ") + "later, ".length,
			end: text.indexOf("later, ") + "later, ".length + "pay the fee".length,
		});
	});

	it("carries prefix/suffix on the quote selector when present", () => {
		const [a] = toW3CAnnotations([view({ exact: "fee", prefix: "the ", suffix: "." })], "urn:msg", "the fee.");
		expect(a.target.selector[0]).toEqual({ type: "TextQuoteSelector", exact: "fee", prefix: "the ", suffix: "." });
	});
});
