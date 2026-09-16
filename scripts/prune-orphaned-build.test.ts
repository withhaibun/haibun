import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error a plain JavaScript build script, which states no types
import { missingBuildOutput, staleBuildRecords } from "./prune-orphaned-build.mjs";

/** A module's sources and its build output, as a build leaves them. */
function aModule(sources: string[], built: string[]): string {
	const moduleDir = mkdtempSync(join(tmpdir(), "haibun-build-"));
	for (const source of sources) {
		mkdirSync(join(moduleDir, "src", source, ".."), { recursive: true });
		writeFileSync(join(moduleDir, "src", source), "export {};\n");
	}
	mkdirSync(join(moduleDir, "build"), { recursive: true });
	for (const output of built) {
		mkdirSync(join(moduleDir, "build", output, ".."), { recursive: true });
		writeFileSync(join(moduleDir, "build", output), "export {};\n");
	}
	return moduleDir;
}

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a module's sources the build did not compile", () => {
	it("names each compiled source with no JavaScript in build, and none the build leaves out by design", () => {
		const moduleDir = aModule(["lib/one.ts", "lib/two.ts", "lib/two.test.ts", "types.d.ts", "lib/nested/three.ts"], ["lib/one.js"]);
		made.push(moduleDir);
		expect(missingBuildOutput(moduleDir).sort()).toEqual(["lib/nested/three", "lib/two"]);
	});

	it("names nothing for a module whose every compiled source has its JavaScript", () => {
		const moduleDir = aModule(["lib/one.ts", "lib/one.test.ts"], ["lib/one.js"]);
		made.push(moduleDir);
		expect(missingBuildOutput(moduleDir)).toEqual([]);
	});
});

describe("a module whose build record is older than what it depends on", () => {
	/** A workspace of modules, each with its package, its build record and one declaration, at the times given in seconds. */
	function aWorkspace(modules: Array<{ name: string; dependsOn: string[]; recordAt: number; declaredAt: number }>): string {
		const modulesDir = mkdtempSync(join(tmpdir(), "haibun-modules-"));
		for (const { name, dependsOn, recordAt, declaredAt } of modules) {
			const moduleDir = join(modulesDir, name);
			mkdirSync(join(moduleDir, "build"), { recursive: true });
			writeFileSync(join(moduleDir, "package.json"), JSON.stringify({ name: `@haibun/${name}`, dependencies: Object.fromEntries(dependsOn.map((dep) => [`@haibun/${dep}`, "*"])) }));
			writeFileSync(join(moduleDir, "tsconfig.tsbuildinfo"), "{}");
			utimesSync(join(moduleDir, "tsconfig.tsbuildinfo"), recordAt, recordAt);
			writeFileSync(join(moduleDir, "build", "index.d.ts"), "export {};\n");
			utimesSync(join(moduleDir, "build", "index.d.ts"), declaredAt, declaredAt);
		}
		return modulesDir;
	}

	it("names each module whose build record is older than a dependency's declarations, and none whose record is newer", () => {
		const modulesDir = aWorkspace([
			{ name: "core", dependsOn: [], recordAt: 200, declaredAt: 200 },
			{ name: "shu", dependsOn: ["core"], recordAt: 100, declaredAt: 100 },
			{ name: "cli", dependsOn: ["core"], recordAt: 300, declaredAt: 300 },
		]);
		made.push(modulesDir);
		expect(staleBuildRecords(modulesDir)).toEqual([join(modulesDir, "shu")]);
	});
});
