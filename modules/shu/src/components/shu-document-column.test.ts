// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { windowCutHtml } from "./shu-document-column.js";

describe("document window cut", () => {
	it("a truncated window opens with the cut notice saying how many earlier events are not shown, with the window-size picker embedded", () => {
		const html = windowCutHtml(500, 200);
		expect(html).toContain("300 earlier events are not shown.");
		expect(html).toContain('data-testid="document-window-cut"');
		expect(html).toContain("<shu-window-size></shu-window-size>");
	});

	it("reads naturally for a single hidden event", () => {
		expect(windowCutHtml(201, 200)).toContain("1 earlier event is not shown.");
	});

	it("shows nothing when the whole log fits the window", () => {
		expect(windowCutHtml(200, 200)).toBe("");
		expect(windowCutHtml(50, 50)).toBe("");
	});
});
