/**
 * HTTP requests a feature makes: a JSON payload sent as the request's body without opening a browser page, a binary
 * response saved to storage on disk with only its link held in HTTP response, and an Activity that submits a JSON
 * generation request and fetches the resulting image.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";

import { passWithDefaults } from "@haibun/core/lib/test/lib.js";
import ActivitiesStepper from "@haibun/core/steps/activities-stepper.js";
import LogicStepper from "@haibun/logic/logic-stepper.js";
import { DEFAULT_DEST } from "@haibun/core/lib/domains/protocol.js";
import { getStepperOptionName } from "@haibun/core/lib/domains/util.js";
import VariablesStepper from "@haibun/core/steps/variables-stepper.js";
import StorageMem from "@haibun/storage-mem/storage-mem-stepper.js";
import WebPlaywright from "./web-playwright-stepper.js";
import { BrowserFactory } from "./adapters/browser-factory.js";

const PNG_ONE_PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const PDF_SAMPLE = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf-8");

afterAll(async () => {
	await BrowserFactory.closeBrowsers();
});

const moduleOptions = { [getStepperOptionName(WebPlaywright, "STORAGE")]: "StorageMem", [getStepperOptionName(WebPlaywright, "HEADLESS")]: "true" };

describe("HTTP requests without a browser", () => {
	it("sends a JSON payload as the request's body without opening a browser page", { timeout: 20_000 }, async () => {
		const server = createServer((request, response) => {
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
			`make an HTTP POST to "http://127.0.0.1:${port}/echo" with {"name": "Ada"}`,
			"HTTP status is 200",
			'variable HTTP response.json.method is "POST"',
			'variable HTTP response.json.type is "application/json"',
			'variable HTTP response.json.body is "{\\"name\\":\\"Ada\\"}"',
		];
		try {
			const result = await passWithDefaults([{ path: "/features/request.feature", content: lines.join("\n") }], [WebPlaywright, VariablesStepper, StorageMem, LogicStepper], {
				options: { DEST: DEFAULT_DEST },
				moduleOptions,
			});
			expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
		} finally {
			server.close();
		}
	});

	it("saves binary image and document responses to storage and keeps only links in HTTP response", { timeout: 20_000 }, async () => {
		const server = createServer((request, response) => {
			if (request.url?.startsWith("/prompt") && request.method === "POST") {
				const chunks: Buffer[] = [];
				request.on("data", (chunk: Buffer) => chunks.push(chunk));
				request.on("end", () => {
					const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as { prompt?: Record<string, unknown> };
					response.setHeader("content-type", "application/json");
					response.end(JSON.stringify({ prompt_id: "job-42", nodes: Object.keys(body.prompt ?? {}).length }));
				});
				return;
			}
			if (request.url?.startsWith("/view")) {
				response.setHeader("content-type", "image/png");
				response.end(PNG_ONE_PIXEL);
				return;
			}
			if (request.url?.startsWith("/manual.pdf")) {
				response.setHeader("content-type", "application/pdf");
				response.end(PDF_SAMPLE);
				return;
			}
			response.statusCode = 404;
			response.end("not found");
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const { port } = server.address() as AddressInfo;
		const lines = [
			"Activity: Generate workflow image",
			`make an HTTP POST to "http://127.0.0.1:${port}/prompt" with {"prompt": {"3": {"class_type": "KSampler", "inputs": {"seed": 7}}, "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "out"}}}}`,
			"HTTP status is 200",
			'variable HTTP response.json.prompt_id is "job-42"',
			`accept "image/png" using HTTP GET to "http://127.0.0.1:${port}/view?filename=out.png" as "saved-image.png"`,
			"HTTP status is 200",
			'storage entry "saved-image.png" exists',
			"set generated image url to HTTP response.contentUrl",
			'waypoint Workflow image is generated with storage entry "saved-image.png" exists',
			"",
			"ensure Workflow image is generated",
			'variable HTTP response.encodingFormat is "image/png"',
			'variable HTTP response.text is ""',
			`make an HTTP GET to "http://127.0.0.1:${port}/manual.pdf"`,
			"HTTP status is 200",
			'variable HTTP response.encodingFormat is "application/pdf"',
			"variable HTTP response.contentUrl exists",
			'variable HTTP response.text is ""',
		];
		try {
			const result = await passWithDefaults(
				[{ path: "/features/binary-links.feature", content: lines.join("\n") }],
				[WebPlaywright, VariablesStepper, StorageMem, LogicStepper, ActivitiesStepper],
				{ options: { DEST: DEFAULT_DEST }, moduleOptions },
			);
			expect(result.ok, JSON.stringify(result.featureResults?.[0]?.stepResults?.filter((step) => !step.ok))).toBe(true);
		} finally {
			server.close();
		}
	});
});
