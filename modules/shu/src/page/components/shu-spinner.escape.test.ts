// @vitest-environment jsdom
/** A spinner states what it waits for as text: an id such as a Message-ID (`<a@b>`) is shown, not parsed as markup. */
import { describe, expect, it } from "vitest";
import "./shu-spinner.js";
import type { ShuSpinner } from "./shu-spinner.js";
import { SHU_TAG } from "../../domains/elements.js";

describe("<shu-spinner>", () => {
	it("shows a status bound before it connects as text", async () => {
		const spinner = document.createElement(SHU_TAG.SPINNER) as ShuSpinner;
		spinner.status = "Fetching Email <a@b>...";
		document.body.appendChild(spinner);
		await spinner.updateComplete;
		const status = spinner.shadowRoot?.querySelector(".spinner-status");
		expect(status?.textContent).toBe("Fetching Email <a@b>...");
		expect(status?.children.length, "and holds no element").toBe(0);
	});
});
