import { describe, expect, it } from "vitest";
import { MEDIA_TYPE } from "../../domains/media-types.js";
import { htmlText, indexedText, maximalText, termWords, textOfForm } from "./body-text.js";

const HTML = [
	"<html><head><title>Survey</title><style>.x { color: red }</style><script>var hidden = 'scripted';</script></head><body>",
	"<p>The <b>lagoon</b> survey &amp; its <a href='https://maps.example/lagoon'>map</a></p>",
	"<img src='cid:chart' alt='Quarterly salinity chart'>",
	"<table><tr><td>Station</td><td>Brackish</td></tr></table>",
	"<div style='display: none'>Unsubscribe heron</div><!-- a comment --></body></html>",
].join("");
const MARKDOWN = "The **lagoon** survey & its [map](https://maps.example/lagoon)";
const PLAIN = "The lagoon survey & its map\nStation Brackish";
/** An email's Body: its markdown, with its HTML and its plain text as representations. */
const EMAIL_BODY = {
	mediaType: MEDIA_TYPE.markdown,
	content: MARKDOWN,
	representations: [
		{ mediaType: MEDIA_TYPE.html, content: HTML },
		{ mediaType: MEDIA_TYPE.plain, content: PLAIN },
	],
};

describe("the text of an HTML form", () => {
	it("is each line it renders, then each link target, alternative text and title once in document order, without a script, a style sheet or a comment", () => {
		expect(htmlText(HTML)).toBe(
			["Survey", "The lagoon survey & its map", "Station", "Brackish", "Unsubscribe heron", "https://maps.example/lagoon", "Quarterly salinity chart"].join("\n"),
		);
	});

	it("is read for an HTML form alone, and another form's text is read as it is", () => {
		expect(textOfForm({ mediaType: MEDIA_TYPE.html, content: "<p>a&nbsp;b</p>" })).toBe("a b");
		expect(textOfForm({ mediaType: MEDIA_TYPE.markdown, content: "<p>kept</p>" })).toBe("<p>kept</p>");
	});
});

describe("the words of a text", () => {
	it("are its runs of letters and digits", () => {
		expect(termWords("héron-42, the lagoon.")).toEqual(["héron", "42", "the", "lagoon"]);
	});
});

describe("the text a search indexes for a Body", () => {
	it("holds the text of every form, its text first and an HTML form's extracted text, so a word only one form holds is indexed", () => {
		const indexed = indexedText(EMAIL_BODY);
		expect(indexed).toBe([MARKDOWN, PLAIN, htmlText(HTML)].join("\n\n"));
		expect(indexed).not.toContain("<p>");
	});

	it("is the text of a Body of one form, an HTML form's extracted", () => {
		expect(indexedText({ mediaType: MEDIA_TYPE.plain, content: PLAIN })).toBe(PLAIN);
		expect(indexedText({ mediaType: MEDIA_TYPE.html, content: HTML })).toBe(htmlText(HTML));
	});
});

describe("a Body's maximal text", () => {
	it("is its text, then each line of another form that holds a word the text before it doesn't, each such line once", () => {
		expect(maximalText(EMAIL_BODY)).toBe([MARKDOWN, "", "Station Brackish", "Unsubscribe heron", "Quarterly salinity chart"].join("\n"));
	});

	it("holds every word of every form", () => {
		const body = { mediaType: MEDIA_TYPE.plain, content: "The lagoon", representations: [{ mediaType: MEDIA_TYPE.html, content: HTML }] };
		const words = new Set(termWords(maximalText(body)).map((word) => word.toLowerCase()));
		expect(termWords(htmlText(HTML)).filter((word) => !words.has(word.toLowerCase()))).toEqual([]);
	});

	it("is the text of a Body whose other forms hold only words its text holds, or of a Body of one form", () => {
		expect(maximalText({ mediaType: MEDIA_TYPE.markdown, content: "the **lagoon**", representations: [{ mediaType: MEDIA_TYPE.plain, content: "The lagoon" }] })).toBe(
			"the **lagoon**",
		);
		expect(maximalText({ mediaType: MEDIA_TYPE.html, content: HTML })).toBe(HTML);
	});
});
