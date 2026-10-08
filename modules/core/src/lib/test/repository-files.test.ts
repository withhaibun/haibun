import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importsOf, parsedSource, resolvedSource, sourceFiles, workspacePackages } from "./repository-files.js";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A git repository holding each file with its contents. */
function aRepository(files: Record<string, string>): string {
	const repository = mkdtempSync(join(tmpdir(), "haibun-repository-"));
	made.push(repository);
	execFileSync("git", ["init", "--quiet"], { cwd: repository });
	for (const [path, contents] of Object.entries(files)) {
		mkdirSync(join(repository, dirname(path)), { recursive: true });
		writeFileSync(join(repository, path), contents);
	}
	return repository;
}

describe("a repository's source files", () => {
	it("are the TypeScript files under the roots, apart from declarations, test modules and what git ignores", () => {
		const repository = aRepository({
			".gitignore": "src/generated/\n",
			"src/a.ts": "",
			"src/view.tsx": "",
			"src/a.test.ts": "",
			"src/a.test-fake.ts": "",
			"src/test/kit.ts": "",
			"src/types.d.ts": "",
			"src/generated/b.ts": "",
			"src/notes.md": "",
			"other/c.ts": "",
		});
		expect(sourceFiles(repository, ["src"])).toEqual(["src/a.ts", "src/view.tsx"]);
	});

	it("resolve a relative or workspace specifier to a source file, and don't resolve an external one", () => {
		const repository = aRepository({
			"modules/one/package.json": '{ "name": "@example/one" }',
			"modules/one/src/index.ts": "",
			"modules/one/src/lib/a.ts": "",
			"modules/one/src/lib/b.ts": "",
		});
		const packages = workspacePackages(repository, "modules");
		expect(packages).toEqual({ "@example/one": "modules/one/src" });
		expect(resolvedSource(repository, "modules/one/src/lib/a.ts", "./b.js", packages)).toBe("modules/one/src/lib/b.ts");
		expect(resolvedSource(repository, "modules/one/src/lib/a.ts", "@example/one/lib/b.js", packages)).toBe("modules/one/src/lib/b.ts");
		expect(resolvedSource(repository, "modules/one/src/lib/a.ts", "@example/one", packages)).toBe("modules/one/src/index.ts");
		expect(resolvedSource(repository, "modules/one/src/lib/a.ts", "zod", packages)).toBeUndefined();
	});

	it("import modules statically, dynamically and by re-export, each stated as importing values or only types", () => {
		const repository = aRepository({
			"src/a.ts": [
				'import { a } from "./values.js";',
				'import type { T } from "./types.js";',
				'import { type U, type V } from "./named-types.js";',
				'export type { W } from "./re-types.js";',
				'export { b } from "./re-values.js";',
				'export const c = () => import("./later.js");',
			].join("\n"),
		});
		expect(importsOf(parsedSource(repository, "src/a.ts")).map(({ specifier, typeOnly, line }) => [specifier, typeOnly, line])).toEqual([
			["./values.js", false, 1],
			["./types.js", true, 2],
			["./named-types.js", true, 3],
			["./re-types.js", true, 4],
			["./re-values.js", false, 5],
			["./later.js", false, 6],
		]);
	});
});
