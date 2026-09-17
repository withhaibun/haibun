import { afterAll, describe, expect, it } from "vitest";

import { failWithDefaults } from "@haibun/core/lib/test/lib.js";
import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebPlaywright from "./web-playwright.js";
import { BrowserFactory } from "./BrowserFactory.js";

/** The bound a run states for what a page waits on. */
const TIMEOUT_MS = 500;

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

describe("wait for", () => {
	it("waits for a test id as long as the run's timeout states, and names that bound when the element doesn't appear", { timeout: 20_000 }, async () => {
		const features = [{ path: "/features/wait.feature", content: `set absent as page-test-id to "absent"\nwait for absent\n` }];
		const moduleOptions = {
			[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
			[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
			[getStepperOptionName(WebPlaywright, "TIMEOUT")]: String(TIMEOUT_MS),
		};
		const res = await failWithDefaults(features, [WebPlaywright, VariablesStepper, StorageMem], { options: { DEST: DEFAULT_DEST }, moduleOptions });
		const failed = res.featureResults?.[0]?.stepResults.find((step) => !step.ok);
		expect(failed?.in, "the wait is the step that failed").toBe("wait for absent");
		expect(JSON.stringify(failed), "and it failed at the stated bound").toContain(`Timeout ${TIMEOUT_MS}ms exceeded`);
	});
});
