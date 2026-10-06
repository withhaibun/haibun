/**
 * A module that actuality runs doesn't import a test module, so what a run loads is what it calls, and a test helper is
 * free to change for its tests. A test module is a `*.test.ts` file, a `*.test-fake.ts` file, or a file under a `test/`
 * directory of a module's source.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { itemAt } from "./util/item-at.js";

const modulesDir = fileURLToPath(new URL("../../../", import.meta.url));
const TEST_MODULE = /(\.test|\.test-fake)\.tsx?$|\/test\//;
/** An import that names a test module, whether a value or a type. */
const NAMES_A_TEST_MODULE = /(\/test\/|\.test-fake\.js$|\.test\.js$)/;

const sourcesOf = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? sourcesOf(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [join(dir, entry.name)] : [],
	);
const production = readdirSync(modulesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.flatMap((entry) => {
		const src = join(modulesDir, entry.name, "src");
		return readdirSync(join(modulesDir, entry.name)).includes("src") ? sourcesOf(src) : [];
	})
	.filter((file) => !TEST_MODULE.test(relative(modulesDir, file)));
const imported = (source: string) => [...source.matchAll(/^(?:import|export) [^;]*?from "([^"]+)";/gms)].map((found) => itemAt(found, 1));

describe("a module actuality runs", () => {
	it("is found in every module's source, so the rule checks the modules", () => {
		expect(production.length).toBeGreaterThan(300);
	});

	it("doesn't import a test module", () => {
		const importing = production.flatMap((file) =>
			imported(readFileSync(file, "utf-8"))
				.filter((from) => NAMES_A_TEST_MODULE.test(from))
				.map((from) => `${relative(modulesDir, file)} imports ${from}`),
		);
		expect(importing).toEqual([]);
	});
});
