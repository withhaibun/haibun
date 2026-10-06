import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULES = join(import.meta.dirname, "..", "modules");
/** The settings every module builds with, which exclude its tests and test fakes from its build. */
const SETTINGS = "../tsconfig.settings.json";

/** Each module's tsconfig, read as JSON. tsconfig allows line comments, which JSON doesn't. */
const tsconfigs = readdirSync(MODULES, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && readdirSync(join(MODULES, entry.name)).includes("tsconfig.json"))
	.map((entry) => ({ module: entry.name, config: JSON.parse(readFileSync(join(MODULES, entry.name, "tsconfig.json"), "utf8").replace(/^\s*\/\/.*$/gm, "")) }));

describe("each module's build", () => {
	it("extends the shared settings and keeps their exclusions, so a module builds without its tests and test fakes", () => {
		expect(tsconfigs.length).toBeGreaterThan(0);
		for (const { module, config } of tsconfigs) {
			expect(config.extends, `${module} extends the settings`).toBe(SETTINGS);
			expect(config.exclude, `${module} doesn't replace the settings' exclusions`).toBeUndefined();
		}
	});
});
