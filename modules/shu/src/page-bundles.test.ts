import { beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { expectWithinBaseline } from "@haibun/core/lib/test/baseline.js";
import { BUDGET_FIX, buildInMemory, measureBundles } from "@haibun/tooling/bundles.js";
import { SHU_BUNDLES, SHU_ROOT } from "../scripts/bundles.ts";

/** The time the hook takes to build every bundle of the page in memory, as its script builds it. A build isn't a unit check: it
 *  takes 2 s alone, and more than a unit test's 5 s limit beside other tests. */
const BUNDLES_BUILD_TIMEOUT_MS = 60_000;

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
	let measured: Awaited<ReturnType<typeof measureBundles>>;
	beforeAll(async () => {
		measured = await measureBundles(SHU_ROOT, SHU_BUNDLES);
	}, BUNDLES_BUILD_TIMEOUT_MS);

	it("build for a browser, each package once and zod's English locale alone, within their budgets", async () => {
		const { excluded, sizes } = measured;
		expect(excluded).toEqual([]);
		await expectWithinBaseline({
			baselineFile: join(SHU_ROOT, "scripts", "bundles.baseline.json"),
			findings: sizes,
			testFile: "modules/shu/src/page-bundles.test.ts",
			fix: BUDGET_FIX,
		});
	});

	it(
		"inline in a single-file bundle each module the page loads lazily, so a report loads it without fetching a chunk",
		async () => {
			const [page, ...whole] = await Promise.all(SHU_BUNDLES.map((bundle) => buildInMemory(SHU_ROOT, bundle)));
			if (page === undefined) throw new Error("shu declares its page bundle first");
			const lazilyLoaded = Object.values(page.metafile.inputs).flatMap(({ imports }) => imports.filter((i) => i.kind === "dynamic-import").map((i) => i.path));
			expect(lazilyLoaded.length, "the page loads a module lazily").toBeGreaterThan(0);
			for (const { metafile } of whole) {
				expect(
					Object.values(metafile.outputs).flatMap(({ imports }) => imports.filter((i) => i.kind === "dynamic-import")),
					"a single-file bundle holds each module it loads",
				).toEqual([]);
			}
			const report = whole.find(({ metafile }) => Object.keys(metafile.outputs).some((out) => out.endsWith("shu-report-bundle.js")));
			expect(lazilyLoaded.filter((module) => !(report !== undefined && module in report.metafile.inputs))).toEqual([]);
		},
		BUNDLES_BUILD_TIMEOUT_MS,
	);
});
