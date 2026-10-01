import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { failWithDefaults } from "@haibun/core/lib/test/lib.js";
import { DEFAULT_DEST } from "@haibun/core/schema/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/util/index.js";
import StorageMem from "@haibun/storage-mem/storage-mem.js";
import WebPlaywright from "./web-playwright.js";
import { BrowserFactory } from "./BrowserFactory.js";

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

const moduleOptions = { [getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem", [getStepperOptionName(WebPlaywright, "HEADLESS")]: "true" };

describe("go to a webpage", () => {
	it("resolves a relative link against the page it was read from, and refuses one a page doesn't give an address", { timeout: 20_000 }, async () => {
		const NEXT = "/next?page=2";
		const server = createServer((request, response) => response.end(request.url === NEXT ? "<p>the next page</p>" : "<p>the first page</p>"));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const [first, relative, seen] = [`go to the "http://127.0.0.1:${port}/" webpage`, `go to the "${NEXT}" webpage`, `see "the next page"`];
		const run = (content: string) =>
			failWithDefaults([{ path: "/features/goto.feature", content }], [WebPlaywright, StorageMem], { options: { DEST: DEFAULT_DEST }, moduleOptions });
		try {
			const blank = (await run(relative)).featureResults?.[0]?.stepResults.find((step) => step.in === relative);
			expect(blank?.ok, "a relative link from a blank page doesn't resolve").toBe(false);
			expect(JSON.stringify(blank), "and the failure names the link").toContain(JSON.stringify(`"${NEXT}" isn't an address`).slice(1, -1));
			const steps = (await run([first, relative, seen].join("\n"))).featureResults?.[0]?.stepResults ?? [];
			expect(steps.find((step) => step.in === relative)?.ok, "from a page, it resolves against that page").toBe(true);
			expect(steps.find((step) => step.in === seen)?.ok, "and the page it names is the one shown").toBe(true);
		} finally {
			server.close();
		}
	});
});
