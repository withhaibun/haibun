/** Each module builds with the shared settings, and references the modules its code imports, so `tsc -b` builds them first. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { trackedFiles } from "@haibun/core/lib/test/group-rules.js";

const REPOSITORY = join(import.meta.dirname, "..");
const MODULES = "modules";
/** The settings every module builds with, which exclude its tests and test fakes from its build. */
const SETTINGS = "../tsconfig.settings.json";
const HAIBUN_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']@haibun\/([\w-]+)/g;
/** The folders of a module's code that its build compiles or runs: its source, and the scripts of its bundles. */
const BUILT = ["src", "scripts"];
/** The code a module's build leaves out, as the shared settings exclude it: its tests and test fakes. */
const UNBUILT = /\.test\.tsx?$|\.test-fake\.ts$/;

/** Each module's tsconfig, read as TypeScript reads it, which allows comments. */
const tsconfigs = readdirSync(join(REPOSITORY, MODULES), { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && readdirSync(join(REPOSITORY, MODULES, entry.name)).includes("tsconfig.json"))
	.map((entry) => ({ module: entry.name, config: ts.readConfigFile(join(REPOSITORY, MODULES, entry.name, "tsconfig.json"), ts.sys.readFile).config }));

/** The other modules a module's built code imports, by their folder. */
const importedModules = (module: string): string[] => {
	const tracked = BUILT.flatMap((folder) => ["ts", "tsx"].flatMap((extension) => trackedFiles(REPOSITORY, `:(glob)${MODULES}/${module}/${folder}/**/*.${extension}`)));
	const imported = tracked
		.filter((file) => !UNBUILT.test(file))
		.flatMap((file) => [...readFileSync(join(REPOSITORY, file), "utf8").matchAll(HAIBUN_IMPORT)].map((m) => String(m[1])));
	return [...new Set(imported)].filter((name) => name !== module).sort();
};

describe("each module's build", () => {
	it("extends the shared settings and keeps their exclusions, so a module builds without its tests and test fakes", () => {
		expect(tsconfigs.length).toBeGreaterThan(0);
		for (const { module, config } of tsconfigs) {
			expect(config.extends, `${module} extends the settings`).toBe(SETTINGS);
			expect(config.exclude, `${module} doesn't replace the settings' exclusions`).toBeUndefined();
		}
	});

	it("references exactly the modules its code imports, so tsc -b builds what a module reads before the module", () => {
		for (const { module, config } of tsconfigs) {
			const references: { path: string }[] = config.references === undefined ? [] : config.references;
			const referenced = references.map(({ path }) => path.replace(/^\.\.\//, "")).sort();
			expect(referenced, `${module}'s tsconfig references`).toEqual(importedModules(module));
		}
	});
});
