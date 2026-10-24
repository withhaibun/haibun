// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { html, render } from "lit";
import { emptyOrLoading, readAgainControl, unavailableOrEmpty } from "./empty-state.js";

const EMPTY = { message: "Actuality doesn't hold an event at this level.", next: html`<a href="#steps">its steps</a>` };

describe("an empty state", () => {
	it("reports that it is waiting, and never the empty message, while the data has not been read", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(false, EMPTY), c);
		expect(c.textContent).toContain("Waiting");
		expect(c.textContent).not.toContain(EMPTY.message);
	});

	it("shows the empty message and what it leads on to, without a loading indicator, once loaded", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(true, EMPTY), c);
		expect(c.textContent).toContain(EMPTY.message);
		expect(c.querySelector("a")?.textContent).toBe("its steps");
		expect(c.textContent).not.toContain("Loading");
	});

	it("states data that couldn't be read apart from empty data, with the control that reads it again", () => {
		const c = document.createElement("div");
		let read = 0;
		render(unavailableOrEmpty(true, { message: "The server didn't return actuality.", next: readAgainControl(() => read++) }, EMPTY), c);
		expect(c.querySelector(".unavailable")?.textContent).toContain("The server didn't return actuality.");
		c.querySelector("button")?.click();
		expect(read).toBe(1);
	});
});
