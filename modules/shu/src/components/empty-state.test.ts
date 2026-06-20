// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "lit";
import { emptyOrLoading } from "./empty-state.js";

describe("emptyOrLoading", () => {
	it("shows a loading indicator and never the empty message while not loaded", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(false, "No events at this level."), c);
		expect(c.textContent).toContain("Loading");
		expect(c.textContent).not.toContain("No events at this level.");
	});

	it("shows the empty message (no loading indicator) once loaded", () => {
		const c = document.createElement("div");
		render(emptyOrLoading(true, "No events at this level."), c);
		expect(c.textContent).toContain("No events at this level.");
		expect(c.textContent).not.toContain("Loading");
	});
});
