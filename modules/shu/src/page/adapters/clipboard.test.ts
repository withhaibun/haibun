// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { browserClipboard } from "./clipboard.js";

const copyText = (text: string): Promise<boolean> => browserClipboard(window).copy(text);

describe("copying text to the clipboard", () => {
	beforeEach(() => {
		Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
	});

	it("copies the exact text (e.g. a file's contents)", async () => {
		const fileContents = "# notes.md\n\nline one\nline two with a , and a - dash";
		expect(await copyText(fileContents)).toBe(true);
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fileContents);
	});

	it("falls back to execCommand when the Clipboard API is unavailable (e.g. a file:// report)", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
		const exec = vi.fn(() => true);
		document.execCommand = exec as unknown as typeof document.execCommand;
		expect(await copyText("file body text")).toBe(true);
		expect(exec).toHaveBeenCalledWith("copy");
	});
});
