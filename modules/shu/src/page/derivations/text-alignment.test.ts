// A quote of a Body's stored markdown reads in the text the view renders without the markup, and a reader's selection in that text
// quotes the stored characters it renders.
import { describe, expect, it } from "vitest";
import { alignTexts, renderedQuote, renderedRange, storedRange } from "./text-alignment.js";

const STORED = "Ada asked **Grace** to demo [the engine](https://example.org/engine) in London.";
const RENDERED = "Ada asked Grace to demo the engine in London.";

describe("the alignment of a rendered text with its stored text", () => {
	const alignment = alignTexts(STORED, RENDERED);

	it("places a quote of the stored text across markup on the rendered characters it renders", () => {
		const at = renderedQuote(alignment, { exact: "**Grace** to demo [the engine]" });
		expect(at === null ? undefined : RENDERED.slice(at.start, at.end)).toBe("Grace to demo the engine");
	});

	it("places a quote by its words around it, so a repeated quote reads at its occurrence", () => {
		const twice = alignTexts("a *b* a *b*", "a b a b");
		expect(renderedQuote(twice, { exact: "b", prefix: "a *b* a *" })).toEqual({ start: 6, end: 7 });
	});

	it("quotes the stored characters a selection of the rendered text renders, markup within them", () => {
		const start = RENDERED.indexOf("Grace");
		const at = storedRange(alignment, { start, end: start + "Grace to demo".length });
		expect(at === null ? undefined : STORED.slice(at.start, at.end)).toBe("Grace** to demo");
	});

	it("reads a range the rendered text doesn't hold as null", () => {
		expect(renderedRange(alignment, { start: STORED.indexOf("https"), end: STORED.indexOf("engine)") })).toBeNull();
		expect(renderedQuote(alignment, { exact: "Paris" })).toBeNull();
	});

	it("leaves a character the renderer writes unmatched", () => {
		const written = alignTexts("1. one", "•one");
		expect(storedRange(written, { start: 0, end: 1 }), "the bullet the renderer wrote").toBeNull();
		expect(storedRange(written, { start: 1, end: 4 })).toEqual({ start: 3, end: 6 });
	});
});
