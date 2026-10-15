import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { expectWithinBaseline } from "@haibun/core/lib/test/baseline.js";
import { BUDGET_FIX, measureBundles } from "../../../bundle-preset.ts";
import { SHU_BUNDLES, SHU_ROOT } from "../scripts/bundles.ts";

/**
 * The page's bundles build for a browser, within their budgets.
 *
 * The page imports core modules that a run imports too, and a module only a run can load, such as the async context a
 * step is held in, cannot be bundled for a browser. A core module the page reaches that imports one fails the bundle,
 * and a watch that fails doesn't leave a bundle to serve, so the page doesn't load. Each bundle is built here as its script
 * builds it, so the import that reaches the page is named where it was made. Its metafile states what loading each entry
 * fetches, which `scripts/bundles.baseline.json` holds to a budget that only shrinks (PF24).
 */
describe("the page's bundles", () => {
	it("build for a browser, each package once and zod's English locale alone, within their budgets", async () => {
		const { excluded, sizes } = await measureBundles(SHU_ROOT, SHU_BUNDLES);
		expect(excluded).toEqual([]);
		expectWithinBaseline({ baselineFile: join(SHU_ROOT, "scripts", "bundles.baseline.json"), findings: sizes, testFile: "modules/shu/src/page-bundles.test.ts", fix: BUDGET_FIX });
	});
});
