import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

const moduleOptions = {
	[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
	[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
	[getStepperOptionName(WebPlaywright, "TIMEOUT")]: String(TIMEOUT_MS),
};

describe("wait for", () => {
	it("waits for a test id as long as actuality's timeout states, and names that bound when the element doesn't appear", { timeout: 20_000 }, async () => {
		const features = [{ path: "/features/wait.feature", content: `set absent as page-test-id to "absent"\nwait for absent\n` }];
		const res = await failWithDefaults(features, [WebPlaywright, VariablesStepper, StorageMem], { options: { DEST: DEFAULT_DEST }, moduleOptions });
		const failed = res.featureResults?.[0]?.stepResults.find((step) => !step.ok);
		expect(failed?.in, "the wait is the step that failed").toBe("wait for absent");
		expect(JSON.stringify(failed), "and it failed at the stated bound").toContain(`Timeout ${TIMEOUT_MS}ms exceeded`);
	});

	it("waits within the document an iframe shows, where the container is the iframe", { timeout: 20_000 }, async () => {
		const server = createServer((_request, response) => response.end("<iframe srcdoc='<p data-testid=framed>In the frame</p>'></iframe>"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const inFrame = `in "iframe", wait for framed`;
		const inPage = "wait for framed";
		const content = [`go to the "http://127.0.0.1:${port}/" webpage`, `set framed as page-test-id to "framed"`, inFrame, inPage].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/frame.feature", content }], [WebPlaywright, VariablesStepper, StorageMem], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			const outcome = (line: string) => res.featureResults?.[0]?.stepResults.findLast((step) => step.in === line)?.ok;
			expect(outcome(inFrame), "found in the frame").toBe(true);
			expect(outcome(inPage), "and not in the page that frames it").toBe(false);
		} finally {
			server.close();
		}
	});
});
