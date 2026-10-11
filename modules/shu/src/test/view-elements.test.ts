import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { viewDirectories, VIEWS } from "./data-access-scan.js";
import { ELEMENT_BASE, elementsOffBase, inDirectories, readModules, tagsUnimported } from "./view-elements-scan.js";

/**
 * Every element a view module defines extends ShuElement, and a view imports as a value the module that defines each shu
 * tag it renders (`view-elements-scan.ts`).
 */
const SRC = fileURLToPath(new URL("../", import.meta.url));
const modules = readModules(SRC);
const views = inDirectories(modules, viewDirectories(SRC, [VIEWS]));

describe("a view's elements", () => {
	it(`extend ${ELEMENT_BASE}`, () => {
		expect(views.length, "the scan reads shu's views").toBeGreaterThan(50);
		expect(elementsOffBase(views, modules)).toEqual([]);
	});

	it("are defined by a module the view imports as a value", () => {
		expect(tagsUnimported(views, modules).map((found) => found.replace(SRC, ""))).toEqual([]);
	});
});
