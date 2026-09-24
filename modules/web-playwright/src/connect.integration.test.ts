import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

import { failWithDefaults, freePort, getDefaultWorld, passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import { queryFacts } from "@haibun/core/lib/working-memory.js";
import { HTTP_REQUEST_LABEL } from "@haibun/core/lib/resources.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebPlaywright from "./web-playwright.js";
import { BrowserFactory } from "./BrowserFactory.js";
import { VISITED_PAGE_LABEL } from "./domains.js";

const PAGE = `<title>owned</title><button onclick="this.textContent='pressed'">press me</button>`;
const moduleOptions = { [getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem", [getStepperOptionName(WebPlaywright, "HEADLESS")]: "true" };
const steppers = [WebPlaywright, VariablesStepper, StorageMem];

/** The browser a person runs: its own profile and its one page, reachable at a debugging endpoint. */
let owners: BrowserContext;
let ownersPage: Page;
let profile: string;
let endpoint: string;
let site: Server;
let siteUrl: string;

beforeAll(async () => {
	site = createHttpServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
	await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
	siteUrl = `http://127.0.0.1:${(site.address() as { port: number }).port}/`;
	const port = await freePort();
	profile = mkdtempSync(join(tmpdir(), "haibun-connect-"));
	owners = await chromium.launchPersistentContext(profile, { headless: true, args: [`--remote-debugging-port=${port}`] });
	[ownersPage] = owners.pages();
	endpoint = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
	await owners.close();
	rmSync(profile, { recursive: true, force: true });
	await new Promise((resolve) => site.close(resolve));
});

describe("connect to the browser at {endpoint}", () => {
	it("acts on the one page the connected browser holds open, records none of its browsing, and leaves it open", { timeout: 30_000 }, async () => {
		const feature = `connect to the browser at "${endpoint}"\ngo to the "${siteUrl}" webpage\nclick "press me"\nsee "pressed"\ntake an accessibility snapshot\n`;
		const res = await passWithDefaults([{ path: "/features/connect.feature", content: feature }], steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
		expect(res.ok).toBe(true);

		expect(ownersPage.isClosed(), "the owner's page is still open after the feature ends").toBe(false);
		expect(await ownersPage.textContent("button"), "the click landed on the owner's page").toBe("pressed");

		expect(await queryFacts(res.world, "name", VISITED_PAGE_LABEL), "the owner's navigation is not the run's visit").toEqual([]);
		expect(await queryFacts(res.world, "url", HTTP_REQUEST_LABEL), "the owner's requests are not traced").toEqual([]);

		const snapshot = res.featureResults?.[0]?.stepResults.find((step) => step.in === "take an accessibility snapshot")?.products as {
			url: string;
			title: string;
			snapshot: string;
			_links: Record<string, { method: string }>;
		};
		expect(snapshot.url).toBe(siteUrl);
		expect(snapshot.title).toBe("owned");
		expect(snapshot.snapshot).toContain('button "pressed"');
		const stepNames = Object.keys(new WebPlaywright().steps);
		const linked = Object.values(snapshot._links).map((link) => link.method);
		expect(linked).toContain("WebPlaywright-click");
		expect(
			linked.every((method) => stepNames.includes(method.replace(/^WebPlaywright-/, ""))),
			"every link names a step the stepper declares",
		).toBe(true);
	});

	it("connects again when the connection ends outside the run, rather than keeping the ended one", { timeout: 30_000 }, async () => {
		const factory = BrowserFactory.getBrowserFactory(getDefaultWorld(), { options: {}, browserType: chromium, launchOptions: {}, cdp: endpoint });
		const ended = await factory.getBrowser("chromium");
		await ended.close();
		const next = await factory.getBrowser("chromium");
		expect(next).not.toBe(ended);
		expect(next.isConnected()).toBe(true);
		expect(ownersPage.isClosed(), "ending a connection doesn't close the owner's page").toBe(false);
	});

	it("connects again in the next feature, after the run disconnected at the end of the first", { timeout: 30_000 }, async () => {
		const feature = `connect to the browser at "${endpoint}"\ngo to the "${siteUrl}" webpage\nclick "press me"\n`;
		const features = [
			{ path: "/features/first.feature", content: feature },
			{ path: "/features/second.feature", content: feature },
		];
		const res = await passWithDefaults(features, steppers, { options: { DEST: DEFAULT_DEST }, moduleOptions });
		expect(res.ok).toBe(true);
		expect(res.featureResults?.map((result) => result.ok)).toEqual([true, true]);
		expect(ownersPage.isClosed()).toBe(false);
	});

	it("refuses an option that configures a browser the run launches", { timeout: 30_000 }, async () => {
		const options = { ...moduleOptions, [getStepperOptionName(WebPlaywright, WebPlaywright.PERSISTENT_DIRECTORY)]: profile };
		const res = await failWithDefaults([{ path: "/features/refused.feature", content: `connect to the browser at "${endpoint}"\n` }], steppers, {
			options: { DEST: DEFAULT_DEST },
			moduleOptions: options,
		});
		const failed = res.featureResults?.[0]?.stepResults.find((step) => !step.ok);
		expect(JSON.stringify(failed)).toContain(`takes no ${WebPlaywright.PERSISTENT_DIRECTORY}`);
	});

	it("refuses to connect once a step has opened a page of a launched browser", { timeout: 30_000 }, async () => {
		const res = await failWithDefaults([{ path: "/features/late.feature", content: `go to the "${siteUrl}" webpage\nconnect to the browser at "${endpoint}"\n` }], steppers, {
			options: { DEST: DEFAULT_DEST },
			moduleOptions,
		});
		const failed = res.featureResults?.[0]?.stepResults.find((step) => !step.ok);
		expect(failed?.in).toBe(`connect to the browser at "${endpoint}"`);
		expect(JSON.stringify(failed)).toContain("before any step opens a page");
	});
});
