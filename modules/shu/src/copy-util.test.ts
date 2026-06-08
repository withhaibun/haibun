// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { copyButtonHtml, bindCopyButtons } from "./copy-util.js";

describe("copy buttons copy their registered text", () => {
	beforeEach(() => {
		Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
	});

	it("copies the exact registered text on click (e.g. a file's contents)", async () => {
		const fileContents = "# notes.md\n\nline one\nline two with a , and a - dash";
		const container = document.createElement("div");
		container.innerHTML = copyButtonHtml(fileContents);
		bindCopyButtons(container);
		const btn = container.querySelector(".copy-btn") as HTMLElement;
		btn.dispatchEvent(new MouseEvent("click"));
		await Promise.resolve();
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fileContents);
		await new Promise((r) => setTimeout(r, 0));
		expect(btn.textContent).toBe("✅"); // visible success
	});

	it("falls back to execCommand when the Clipboard API is unavailable (e.g. a file:// report)", async () => {
		Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); // simulate blocked/absent API
		const exec = vi.fn(() => true);
		document.execCommand = exec as unknown as typeof document.execCommand;
		const container = document.createElement("div");
		container.innerHTML = copyButtonHtml("file body text");
		bindCopyButtons(container);
		(container.querySelector(".copy-btn") as HTMLElement).dispatchEvent(new MouseEvent("click"));
		await new Promise((r) => setTimeout(r, 0));
		expect(exec).toHaveBeenCalledWith("copy");
	});
});
