import { describe, it, expect, afterAll } from "vitest";

import { failWithDefaults, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import A11yAxe from "./a11y-axe-stepper.js";
import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { BrowserFactory } from "@haibun/web-playwright/BrowserFactory.js";

import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import { EARL_ASSERTION_EDGE, EARL_LABEL, EARL_OUTCOME } from "./domains/earl.js";
import { SEQ_PATH_LABEL } from "@haibun/core/lib/resources.js";
import { itemAt } from "@haibun/core/lib/util/item-at.js";
import WebPlaywright from "@haibun/web-playwright";
import { readEvery } from "@haibun/core/lib/records/pipelines/record-reads.js";

const PASSES_URI = new URL("../files/test/passes.html", import.meta.url);
const FAILS_URI = new URL("../files/test/fails.html", import.meta.url);

const options = { DEST: DEFAULT_DEST };
const moduleOptions = {
	[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
	[getStepperOptionName(A11yAxe, "STORAGE")]: "StorageMem",
	[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
};

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

/** A browser launch, a page load and an axe pass take as long as the machine gives them, so each case states a bound it
 *  reaches on a busy machine rather than a quick one. */
const LAUNCHES_A_BROWSER = { timeout: 60_000 };

describe("a11y test from uri", () => {
	it("passes", LAUNCHES_A_BROWSER, async () => {
		const features = [
			{
				path: "/features/test.feature",
				content: `
go to the "${PASSES_URI}" webpage
page is accessible accepting serious "99" and moderate "90"
`,
			},
		];

		const res = await passWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
		expect(res.ok).toBe(true);
		expect(res.featureResults?.[0]?.stepResults?.[1]?.artifact).toMatchObject({ artifactType: "html" });
	});
	it("fails", LAUNCHES_A_BROWSER, async () => {
		const features = [
			{
				path: "/features/test.feature",
				content: `
go to the "${FAILS_URI}" webpage
page is accessible accepting serious "0" and moderate "0"
`,
			},
		];

		const res = await failWithDefaults(features, [A11yAxe, WebPlaywright, StorageMem], { options, moduleOptions });
		expect(res.ok).toBe(false);
		expect(res.featureResults?.[0]?.stepResults?.[1]?.artifact).toMatchObject({ artifactType: "html" });
		// Each rule axe applied is an assertion the checking step made, and a violation is a failed result.
		const store = res.world.shared.getStore();
		const failed = (await readEvery(store, { label: EARL_LABEL.testResult })).filter(({ outcome }) => outcome === EARL_OUTCOME.failed).map(({ id }) => String(id));
		expect(failed.length).toBeGreaterThan(0);
		const assertion = itemAt(await store.query({ predicate: EARL_ASSERTION_EDGE.result, object: itemAt(failed, 0), namedGraph: EARL_LABEL.assertion }), 0);
		const step = itemAt(await store.query({ subject: assertion.subject, predicate: EARL_ASSERTION_EDGE.wasGeneratedBy, namedGraph: EARL_LABEL.assertion }), 0);
		// The world doesn't declare the step type, so the test reads the step's text as a quad.
		expect(await store.get(String(step.object), "stepText", SEQ_PATH_LABEL)).toEqual(expect.stringContaining("page is accessible"));
	});
});
