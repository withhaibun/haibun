/**
 * A module that actuality runs doesn't import a test module, so what a run loads is what it calls, and a test helper is
 * free to change for its tests. A test module is a `*.test.ts` file, a `*.test-fake.ts` file, or a file under a `test/`
 * directory of a module's source.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importsOf, parsedSource, sourceFiles, workspacePackages } from "./test/repository-files.js";

const REPOSITORY = fileURLToPath(new URL("../../../../", import.meta.url));
/** An import that names a test module, whether a value or a type. */
const NAMES_A_TEST_MODULE = /(\/test\/|\.test-fake\.js$|\.test\.js$)/;
const production = sourceFiles(REPOSITORY, Object.values(workspacePackages(REPOSITORY, "modules")));

describe("a module actuality runs", () => {
	it("is found in every module's source, so the rule checks the modules", () => {
		expect(production.length).toBeGreaterThan(300);
	});

	it("doesn't import a test module", () => {
		const importing = production.flatMap((file) =>
			importsOf(parsedSource(REPOSITORY, file))
				.filter(({ specifier }) => NAMES_A_TEST_MODULE.test(specifier))
				.map(({ specifier }) => `${file} imports ${specifier}`),
		);
		expect(importing).toEqual([]);
	});
});
