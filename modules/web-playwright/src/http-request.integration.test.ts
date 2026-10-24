/**
 * A request a feature makes with a JSON payload, from the page it is on: the payload is the request's body, sent as JSON, and
 * the response is read as any request's is.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { passWithDefaults } from "@haibun/core/lib/test/lib.js";
import { DEFAULT_DEST } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { BrowserFactory } from "./adapters/browser-factory.js";

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

const moduleOptions = { [getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem", [getStepperOptionName(WebPlaywright, "HEADLESS")]: "true" };

describe("a request with a JSON payload", () => {
	it("sends the payload as the request's JSON body", { timeout: 20_000 }, async () => {
		const server = createServer((request, response) => {
			if (request.method === "GET") return void response.end("<p>the page that makes the request</p>");
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ method: request.method, type: request.headers["content-type"], body: Buffer.concat(chunks).toString("utf-8") }));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const lines = [
			`go to the "http://127.0.0.1:${port}/" webpage`,
			`make an HTTP POST to "http://127.0.0.1:${port}/echo" with {"name": "Ada"}`,
			"HTTP status is 200",
			'variable HTTP response.json.method is "POST"',
			'variable HTTP response.json.type is "application/json"',
			'variable HTTP response.json.body is "{\\"name\\":\\"Ada\\"}"',
		];
		try {
			const result = await passWithDefaults([{ path: "/features/request.feature", content: lines.join("\n") }], [WebPlaywright, VariablesStepper, StorageMem], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
		} finally {
			server.close();
		}
	});
});
