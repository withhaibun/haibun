import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { lazyLoadsStatic } from "./bundles.ts";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Builds `entry` as a single file, with or without the plugin, from sources written to a folder of its own. */
async function singleFile(sources: Record<string, string>, plugins: (typeof lazyLoadsStatic)[]): Promise<string> {
	dir = mkdtempSync(join(tmpdir(), "lazy-loads-"));
	for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text);
	const { outputFiles } = await build({ entryPoints: [join(dir, "entry.ts")], bundle: true, write: false, format: "iife", plugins });
	return outputFiles.map((file) => file.text).join("\n");
}

const SOURCES = {
	"entry.ts": 'type TLoaded = typeof import("./loaded.ts");\nconst loaded: Promise<TLoaded> = import("./loaded.ts");\nvoid loaded.then(({ value }) => console.log(value));\n',
	"loaded.ts": 'export const value = "loaded";\n',
};

describe("a single-file bundle's lazy loads", () => {
	it("read the module a source loads lazily from a static import, so the bundle doesn't wrap it in an initializer", async () => {
		const wrapped = await singleFile(SOURCES, []);
		const loadedStatically = await singleFile(SOURCES, [lazyLoadsStatic]);
		expect(wrapped).toContain("__esm");
		expect(loadedStatically).not.toContain("__esm");
		expect(loadedStatically).toContain('"loaded"');
	});
});
