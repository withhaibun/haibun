// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { parseViewQuery } from "./page/derivations/view-query.js";
import { appAccessLevel } from "./page/controllers/view-query-controller.js";

/**
 * appAccessLevel returns the access level of the page's reads. Every read and every question is sent at that level. It
 * is parsed from the address by the view query's parser, so a column's reads and a person's questions use one level.
 */
describe("the access level of the page's reads", () => {
	afterEach(() => {
		window.location.hash = "";
	});

	it("is the level the view query parses, for either form of the hash", () => {
		for (const hash of ["#?access=public", "#access=public"]) {
			window.location.hash = hash;
			expect(appAccessLevel(), hash).toBe("public");
			expect(appAccessLevel()).toBe(parseViewQuery(window.location.hash).access);
		}
	});

	it("rejects a level the schema doesn't name, rather than sending it with every question", () => {
		window.location.hash = "#?access=Private";
		expect(() => appAccessLevel()).toThrow();
	});
});
