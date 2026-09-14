import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The page's bundles build for a browser.
 *
 * The page imports core modules that a run imports too, and a module only a run can load, such as the async context a
 * step is held in, cannot be bundled for a browser. A core module the page reaches that imports one fails the bundle,
 * and a watch that fails leaves no bundle to serve, so the page loads nothing. Each bundle is built here as its script
 * builds it, so the import that reaches the page is named where it was made.
 */
const source = dirname(fileURLToPath(import.meta.url));
const PAGE_ENTRIES = ["app.ts", "components/polymorphic-bundle.ts"];

describe("the page's bundles", () => {
	it.each(PAGE_ENTRIES)("%s builds for a browser", async (entry) => {
		const failed = await build({
			entryPoints: [join(source, entry)],
			bundle: true,
			write: false,
			format: "iife",
			platform: "browser",
			target: "es2022",
			conditions: ["development"],
			logLevel: "silent",
		}).then(
			() => [],
			(err: { errors?: Array<{ text: string; location?: { file: string } | null }> }) => (err.errors ?? []).map((e) => `${e.location?.file ?? ""}: ${e.text}`),
		);
		expect(failed).toEqual([]);
	});
});
