import { describe, it, expect } from "vitest";
import { PAGE_MARKER_FORMAT, pageOfPassage } from "./media-fragments.js";

const pageMark = (page: number) => PAGE_MARKER_FORMAT.replace("{page_num}", String(page));
const PAGES = `${pageMark(1)}The rule is stated.${pageMark(2)}The rule is applied. The rule is stated again.`;

describe("the page of a passage", () => {
	it("is the page the last mark before the passage begins", () => {
		expect(pageOfPassage(PAGES, { exact: "The rule is applied." })).toBe(2);
		expect(pageOfPassage(PAGES, { exact: "The rule is stated" })).toBe(1);
	});

	it("is the page of the occurrence the passage's context picks", () => {
		expect(pageOfPassage(PAGES, { exact: "The rule is stated", suffix: " again" })).toBe(2);
	});

	it("isn't stated where the text doesn't hold the passage, or doesn't mark its pages", () => {
		expect(pageOfPassage(PAGES, { exact: "not in the text" })).toBeUndefined();
		expect(pageOfPassage("The rule is stated.", { exact: "The rule is stated" })).toBeUndefined();
	});
});
