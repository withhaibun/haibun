import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { failWithDefaults } from "@haibun/core/lib/test/lib.js";
import { DEFAULT_DEST } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { BrowserFactory } from "./adapters/browser-factory.js";

/** The bound of a page's waits in these features. */
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

	it("points at a target as a reader does, and leaves it for the next target pointed at", { timeout: 20_000 }, async () => {
		const page = `<button data-testid=chip>a chip</button><button data-testid=elsewhere>elsewhere</button><p data-testid=preview hidden>The preview</p>
<script>const chip = document.querySelector("[data-testid=chip]"), preview = document.querySelector("[data-testid=preview]");
chip.addEventListener("mouseenter", () => preview.hidden = false); chip.addEventListener("mouseleave", () => preview.hidden = true);</script>`;
		const server = createServer((_request, response) => response.end(page));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const [shown, gone] = ["wait for preview", "wait until preview is gone"];
		const content = [
			`go to the "http://127.0.0.1:${port}/" webpage`,
			...["chip", "elsewhere", "preview"].map((id) => `set ${id} as page-test-id to "${id}"`),
			"hover over chip",
			shown,
			"hover over elsewhere",
			gone,
		].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/hover.feature", content }], [WebPlaywright, VariablesStepper, StorageMem], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			const outcome = (line: string) => res.featureResults?.[0]?.stepResults.findLast((step) => step.in === line)?.ok;
			expect([outcome(shown), outcome(gone)], "the preview shows while the pointer is on the chip, and goes when it leaves").toEqual([true, true]);
		} finally {
			server.close();
		}
	});

	it("turns the wheel over a target as a reader reading back does, and waits until a target is gone", { timeout: 20_000 }, async () => {
		const page = `<div data-testid=log style="height:100px;overflow:auto"><div style="height:1000px"></div></div><p data-testid=latest>The newest line</p>
<script>const log = document.querySelector("[data-testid=log]"); log.scrollTop = 900; log.addEventListener("wheel", () => document.querySelector("[data-testid=latest]").hidden = true);</script>`;
		const server = createServer((_request, response) => response.end(page));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const gone = "wait until latest is gone";
		const content = [
			`go to the "http://127.0.0.1:${port}/" webpage`,
			`set log as page-test-id to "log"`,
			`set latest as page-test-id to "latest"`,
			"wait for latest",
			"scroll log up a screen",
			gone,
		].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/gone.feature", content }], [WebPlaywright, VariablesStepper, StorageMem], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			expect(res.featureResults?.[0]?.stepResults.findLast((step) => step.in === gone)?.ok, "the wheel reached the log, and the line it hid is gone").toBe(true);
		} finally {
			server.close();
		}
	});
});
