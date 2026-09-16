// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { appAccessLevel } from "./util.js";
import { parseViewQuery } from "./view-query.js";

/**
 * The level the page reads at, which every question and every read is sent with. It is read from the address as the view
 * query reads it, so the level a column reads at and the level a question is asked at are the same level.
 */
describe("the level the page reads at", () => {
	afterEach(() => {
		window.location.hash = "";
	});

	it("is the level the view query reads, whichever form the address writes the hash in", () => {
		for (const hash of ["#?access=public", "#access=public"]) {
			window.location.hash = hash;
			expect(appAccessLevel(), hash).toBe("public");
			expect(appAccessLevel()).toBe(parseViewQuery(window.location.hash).access);
		}
	});

	it("refuses a level the schema does not name, rather than sending it with every question", () => {
		window.location.hash = "#?access=Private";
		expect(() => appAccessLevel()).toThrow();
	});
});
