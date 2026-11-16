/**
 * What a page waits for: the bounded `until` over a locator property, the in-frame scope, the pointer targets, the
 * scroll-away target that is gone, and the body's text. Each wait is composed by the waypoints in
 * @haibun/web-playwright/waypoints over `variable {target}.count` and `variable {target}.visible`, evaluated at the page;
 * the features below state those activity steps inline, the unit-level harness leaving the waypoint libraries unresolved.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { failWithDefaults } from "@haibun/core/lib/test/lib.js";
import Haibun from "@haibun/core/steps/haibun-stepper.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { DEFAULT_DEST } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TARGET } from "./domains/web-playwright.js";
import { BrowserFactory } from "./adapters/browser-factory.js";

/** The bound of a page's waits in these features. */
const TIMEOUT_MS = 500;
/** The variable each inlined activity names, matching the waypoints' own. */
const TARGET = "web page target";
const asTarget = (way: string): string => `set ${TARGET} as ${way} to `;
const bodySet = asTarget(DOMAIN_PAGE_LOCATOR) + `"body"`;
const waitCount = (bound: string): string => `until variable ${TARGET}.count is more than "0" within "${bound}"`;
const waitGone = (bound: string): string => `until variable ${TARGET}.visible is "false" within "${bound}"`;
const steppers = [WebPlaywright, VariablesStepper, StorageMem, LogicStepper, Haibun];

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

const moduleOptions = {
	[getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem",
	[getStepperOptionName(WebPlaywright, "HEADLESS")]: "true",
	[getStepperOptionName(WebPlaywright, "TIMEOUT")]: String(TIMEOUT_MS),
};

describe("wait for", () => {
	it("waits for a test id's element until the bound its until states, and fails where the element doesn't appear within it", { timeout: 20_000 }, async () => {
		const until = `until variable absent.count is more than "0" within "${TIMEOUT_MS}ms"`;
		const features = [{ path: "/features/wait.feature", content: `set absent as page-test-id to "absent"\n${until}\n` }];
		const res = await failWithDefaults(features, steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
		const failed = res.featureResults?.[0]?.stepResults.find((step) => !step.ok);
		expect(failed?.in, "the waited-for comparison is the step that failed").toBe(`variable absent.count is more than "0"`);
		expect(JSON.stringify(failed), "and the refusal states the comparison that didn't hold").toContain("differs");
	});

	it("waits within the document an iframe shows, where the container is the iframe", { timeout: 20_000 }, async () => {
		const server = createServer((_request, response) => response.end("<iframe srcdoc='<p data-testid=framed>In the frame</p>'></iframe>"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const inFrame = `in "iframe", variable framed.count is more than "0"`;
		const inPage = `variable framed.count is more than "0"`;
		const content = [`go to the "http://127.0.0.1:${port}/" webpage`, `set framed as page-test-id to "framed"`, inFrame, inPage].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/frame.feature", content }], steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
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
		const shown = `until variable preview.visible is "true" within "5s"`;
		const gone = `until variable preview.visible is "false" within "5s"`;
		const content = [
			`go to the "http://127.0.0.1:${port}/" webpage`,
			...["chip", "elsewhere", "preview"].map((id) => `set ${id} as page-test-id to "${id}"`),
			"hover over chip",
			shown,
			"hover over elsewhere",
			gone,
		].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/hover.feature", content }], steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
			const outcome = (inner: string) => res.featureResults?.[0]?.stepResults.findLast((step) => step.in === inner)?.ok;
			expect(
				[outcome(`variable preview.visible is "true"`), outcome(`variable preview.visible is "false"`)],
				"the preview shows while the pointer is on the chip, and goes when it leaves",
			).toEqual([true, true]);
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
		const bind = asTarget(DOMAIN_PAGE_TARGET) + "latest";
		const gone = waitGone(`${TIMEOUT_MS * 2}ms`);
		const content = [
			`go to the "http://127.0.0.1:${port}/" webpage`,
			`set log as page-test-id to "log"`,
			`set latest as page-test-id to "latest"`,
			bind,
			waitCount(`${TIMEOUT_MS * 2}ms`),
			"scroll log up a screen",
			gone,
		].join("\n");
		try {
			const res = await failWithDefaults([{ path: "/features/gone.feature", content }], steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
			expect(res.ok, JSON.stringify(res.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
			expect(
				res.featureResults?.[0]?.stepResults.findLast((step) => step.in === `variable ${TARGET}.visible is "false"`)?.ok,
				"the wheel reached the log, and the line it hid is gone",
			).toBe(true);
		} finally {
			server.close();
		}
	});
});

describe("see", () => {
	it("holds where the body's text contains the text, and refuses text it doesn't contain with the length of the body's text", { timeout: 20_000 }, async () => {
		const shown = "A long page of text";
		const server = createServer((_request, response) => response.end(`<p>${shown}</p>`));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const seen = `variable ${TARGET}.text contains "page of"`;
		const unseen = `variable ${TARGET}.text contains "absent words"`;
		try {
			const res = await failWithDefaults(
				[{ path: "/features/see.feature", content: [`go to the "http://127.0.0.1:${port}/" webpage`, bodySet, seen, unseen].join("\n") }],
				steppers,
				{ options: { DEST: DEFAULT_DEST }, moduleOptions },
			);
			const outcome = (line: string) => res.featureResults?.[0]?.stepResults.findLast((step) => step.in === line);
			expect(outcome(seen)?.ok, "the text the body contains").toBe(true);
			expect(JSON.stringify(outcome(unseen)), "and the refusal names the text and the body's length").toContain(`read ${shown.length} bytes in place`);
		} finally {
			server.close();
		}
	});
});
