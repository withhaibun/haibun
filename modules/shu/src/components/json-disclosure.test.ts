// A record read from the graph is JSON-LD, and printed whole it is mostly the vocabulary it is written in. What it says
// is what a reader opens with; what it is written in is one press away.
import { describe, it, expect } from "vitest";
import { jsonDisclosure, literalWithJson } from "./json-disclosure.js";

describe("a JSON value as disclosures", () => {
	it("shows a scalar as it reads, with nothing to open", () => {
		expect(jsonDisclosure("what the run said", "message")).toContain("what the run said");
		expect(jsonDisclosure("what the run said", "message")).not.toContain("<details");
	});

	it("opens the record itself, so what it says is read without pressing anything", () => {
		const shown = jsonDisclosure({ message: "said", level: "debug" });
		expect(shown).toMatch(/<details[^>]* open/);
		expect(shown).toContain("said");
		expect(shown).toContain("debug");
	});

	it("holds a nested value closed, and says what it holds", () => {
		const shown = jsonDisclosure({ record: { a: 1, b: 2, c: 3 } });
		expect(shown, "the nested one states its size rather than its contents").toContain("3 fields");
		expect(shown.match(/<details[^>]* open/g) ?? [], "only the outermost is open").toHaveLength(1);
	});

	it("counts what an array holds in items", () => {
		expect(jsonDisclosure({ steps: [1, 2] })).toContain("2 items");
		expect(jsonDisclosure({ steps: [1] })).toContain("1 item");
	});

	it("keeps the vocabulary a record is written in closed, however shallow it is", () => {
		const shown = jsonDisclosure({ "@context": { as: "https://www.w3.org/ns/activitystreams#" }, message: "said" });
		const context = shown.slice(shown.indexOf('data-testid="json-@context"') - 60, shown.indexOf('data-testid="json-@context"') + 40);
		expect(context, "@context is a disclosure the reader opens, not one that opens itself").not.toMatch(/<details[^>]* open[^>]*data-testid="json-@context"/);
		expect(shown).toContain("said");
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
