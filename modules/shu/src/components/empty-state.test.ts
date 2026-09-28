// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "lit";
import { emptyOrLoading } from "./empty-state.js";

const EMPTY = "The run doesn't hold an event at this level.";

describe("emptyOrLoading", () => {
	it("reports that it is waiting, and never the empty message, while the data has not been read", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(false, EMPTY), c);
		expect(c.textContent).toContain("Waiting");
		expect(c.textContent).not.toContain(EMPTY);
	});

	it("shows the empty message (without a loading indicator) once loaded", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(true, EMPTY), c);
		expect(c.textContent).toContain(EMPTY);
		expect(c.textContent).not.toContain("Loading");
	});
});
