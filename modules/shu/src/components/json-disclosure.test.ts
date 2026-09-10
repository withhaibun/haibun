// A record read from the graph is JSON-LD. All of it is shown, opened: what it says and the vocabulary it is written
// in, which is part of what it is. The disclosures give it structure a reader can follow and collapse, and take nothing
// away.
import { describe, it, expect } from "vitest";
import { jsonDisclosure, literalWithJson } from "./json-disclosure.js";

describe("a JSON value as disclosures", () => {
	it("shows a scalar as it reads, with nothing to open", () => {
		expect(jsonDisclosure("what the run said", "message")).toContain("what the run said");
		expect(jsonDisclosure("what the run said", "message")).not.toContain("<details");
	});

	it('writes a value so its type is visible, since a record holding "3" is not one holding 3', () => {
		expect(jsonDisclosure("3", "count")).toContain("&quot;3&quot;");
		expect(jsonDisclosure(3, "count")).toContain(">3<");
		expect(jsonDisclosure(null, "count")).toContain("null");
		expect(jsonDisclosure(false, "count")).toContain("false");
	});

	it("names an item by its place and a field by its name", () => {
		const shown = jsonDisclosure({ steps: ["first", "second"] });
		expect(shown).toContain("[0]");
		expect(shown).toContain("[1]");
		expect(shown).toContain("steps");
	});

	it("shows the record opened, so what it says is read without pressing anything", () => {
		const shown = jsonDisclosure({ message: "said", level: "debug" });
		expect(shown).toMatch(/<details[^>]* open/);
		expect(shown).toContain("said");
		expect(shown).toContain("debug");
	});

	it("opens a nested value too, and says what it holds", () => {
		const shown = jsonDisclosure({ record: { a: 1, b: 2, c: 3 } });
		expect(shown, "what it holds, said on the disclosure").toContain("3 fields");
		expect(shown.match(/<details[^>]* open/g) ?? [], "every level is open: a reader collapses what they are done with").toHaveLength(2);
		expect(shown, "and its values are there to read").toContain("3");
	});

	it("counts what an array holds in items", () => {
		expect(jsonDisclosure({ steps: [1, 2] })).toContain("2 items");
		expect(jsonDisclosure({ steps: [1] })).toContain("1 item");
	});

	it("shows the vocabulary a record is written in exactly as it shows everything else", () => {
		// The @context gives a record's terms their meaning, so it is part of what the record is. Nothing here decides
		// that some of a record is worth less than the rest of it, and nothing is shown closed.
		const shown = jsonDisclosure({ "@context": { as: "https://www.w3.org/ns/activitystreams#" }, message: "said" });
		expect(shown).toContain("https://www.w3.org/ns/activitystreams#");
		expect(shown).toContain("said");
		expect(shown.match(/<details(?![^>]* open)/g) ?? [], "nothing is closed").toHaveLength(0);
	});

	it("escapes what a record holds, since a run says whatever it says", () => {
		expect(jsonDisclosure({ message: '<script>alert("x")</script>' })).not.toContain("<script>");
	});
});

describe("a literal that carries JSON", () => {
	it("keeps the words as words and opens what they carry", () => {
		const shown = literalWithJson('RPC: {"method":"action.begin","params":{"why":"blips"}}');
		expect(shown).toContain("RPC:");
		expect(shown).toContain("<details");
		expect(shown, "the method a reader is looking for").toContain("action.begin");
	});

	it("returns a literal carrying no JSON as it reads", () => {
		expect(literalWithJson("what the run said")).toBe("what the run said");
	});

	it("treats braces that are part of what was said as what was said", () => {
		expect(literalWithJson("set {what} to {value}")).not.toContain("<details");
	});
});
