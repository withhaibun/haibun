// @vitest-environment jsdom
// A record read from the graph is JSON-LD. All of it is shown, opened: what it holds and the vocabulary it is written
// in, which is part of what it is. The disclosures give it structure a reader can follow and collapse, and don't remove
// a part of it.
import { describe, it, expect } from "vitest";
import { render, type TemplateResult } from "lit";
import { jsonTpl, literalWithJson } from "./json-disclosure.js";
import { SHU_TAG } from "../../domains/elements.js";
import "./shu-json-tree.js";

/** Renders a template into a new element, and returns the element. */
const into = (shown: TemplateResult | string): HTMLElement => {
	const at = document.createElement("div");
	render(shown, at);
	return at;
};
/** The disclosures of a value, as nodes. */
const tree = (value: unknown, name?: string): HTMLElement => into(jsonTpl(value, name));
const disclosures = (at: HTMLElement): HTMLDetailsElement[] => [...at.querySelectorAll("details")];

describe("a JSON value as disclosures", () => {
	it("shows a scalar as it reads, without a disclosure to open", () => {
		const shown = tree("what actuality logged", "message");
		expect(shown.textContent).toContain("what actuality logged");
		expect(disclosures(shown)).toEqual([]);
	});

	it('writes a value so its type is visible, since a record holding "3" is not one holding 3', () => {
		const value = (held: unknown): string | null | undefined => tree(held, "count").querySelector(".json-value")?.textContent;
		expect(value("3")).toBe('"3"');
		expect(value(3)).toBe("3");
		expect(value(null)).toBe("null");
		expect(value(false)).toBe("false");
	});

	it("names an item by its place and a field by its name", () => {
		const names = [...tree({ steps: ["first", "second"] }).querySelectorAll(".json-name")].map((name) => name.textContent);
		expect(names).toEqual(["steps", "[0]", "[1]"]);
	});

	it("opens every disclosure, at any depth, and states what each holds, so it is read without pressing anything", () => {
		const shown = tree({ record: { a: 1, b: 2, c: 3 }, held: { deeper: { deepest: 1 } } });
		expect(disclosures(shown).every(({ open }) => open)).toBe(true);
		expect([...shown.querySelectorAll(".json-holds")].map((holds) => holds.textContent)).toEqual(["2 fields", "3 fields", "1 field", "1 field"]);
	});

	it("counts what an array holds in items", () => {
		expect(tree({ steps: [1, 2] }).textContent).toContain("2 items");
		expect(tree({ steps: [1] }).textContent).toContain("1 item");
	});

	it("holds the vocabulary a record is written in closed, and holds all of it", () => {
		// A reader reads what a record holds before asking what its terms mean, so @context starts closed. What it holds
		// is written out under it, so opening it is a press and never a request.
		const shown = tree({ "@context": { as: "https://www.w3.org/ns/activitystreams#" }, message: "said" });
		expect(shown.textContent, "the vocabulary is there in full").toContain("https://www.w3.org/ns/activitystreams#");
		expect(
			disclosures(shown)
				.filter(({ open }) => !open)
				.map(({ dataset }) => dataset.testid),
		).toEqual(["json-@context"]);
	});

	it("renders what a record holds as text, so markup it holds isn't parsed", () => {
		const shown = tree({ message: '<script>alert("x")</script>' });
		expect(shown.querySelector("script")).toBeNull();
		expect(shown.textContent).toContain('<script>alert("x")</script>');
	});
});

describe("a JSON value in markup composed as text", () => {
	it("renders the disclosures of the value its text states, in place of the text", async () => {
		const shown = document.createElement("div");
		shown.innerHTML = `<${SHU_TAG.JSON_TREE}>${JSON.stringify({ steps: ["<b>first</b>"] }).replaceAll("<", "&lt;")}</${SHU_TAG.JSON_TREE}>`;
		document.body.appendChild(shown);
		const element = shown.querySelector(SHU_TAG.JSON_TREE) as HTMLElement & { updateComplete: Promise<boolean> };
		await element.updateComplete;
		expect([...element.querySelectorAll(".json-name")].map((name) => name.textContent)).toEqual(["steps", "[0]"]);
		expect(element.querySelector("b"), "the value's text isn't parsed as markup").toBeNull();
		shown.remove();
	});
});

describe("a literal that carries JSON", () => {
	it("keeps the words as words and opens what they carry", () => {
		const shown = into(literalWithJson('RPC: {"method":"action.begin","params":{"why":"blips"}}'));
		expect(shown.querySelector(".json-said")?.textContent).toBe("RPC:");
		expect(disclosures(shown).length).toBeGreaterThan(0);
		expect(shown.textContent, "the method a reader is looking for").toContain("action.begin");
	});

	it("returns a literal that doesn't carry JSON as it reads", () => {
		expect(literalWithJson("what actuality logged")).toBe("what actuality logged");
	});

	it("treats braces that are part of what was provided as what was provided", () => {
		expect(disclosures(into(literalWithJson("set {what} to {value}")))).toEqual([]);
	});
});
