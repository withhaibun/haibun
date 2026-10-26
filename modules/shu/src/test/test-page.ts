/**
 * A page that a browser test of shu serves: its entry built from source as a page's bundle is built, served with what else
 * the page reads at a local origin, and opened in a headless browser. The opened page keeps its errors, its console's
 * errors and its failed requests, which a test states where the page doesn't reach a state the test awaits.
 */
import { build } from "esbuild";
import { HAIBUN_SOURCE, nodeEnvDefine } from "@haibun/tooling/bundles.js";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";

/** Builds the entry at `path` into one module, from the source of the modules it imports. */
export async function builtEntry(path: string): Promise<string> {
	const built = await build({
		entryPoints: [path],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		target: "es2022",
		conditions: [HAIBUN_SOURCE],
		define: nodeEnvDefine(),
	});
	const [file] = built.outputFiles;
	if (file === undefined) throw new Error(`esbuild wrote an empty set of files for ${path}`);
	return file.text;
}

/** Writes the response to a request for `url`, and returns whether the page serves it. A request it doesn't serve is a 404. */
export type TRespond = (url: string, res: ServerResponse) => boolean;

/** An opened test page: its address, the page, what failed on it as a list for a failure message, and its close. */
export type TTestPage = { url: string; page: Page; pageErrors: string[]; failures(): string; close(): Promise<void> };

/** Serves `respond` at a local origin and opens a headless browser's page there, at `viewport` and `deviceScaleFactor`. */
export async function openTestPage(respond: TRespond, opts: { viewport: { width: number; height: number }; deviceScaleFactor: number; args?: string[] }): Promise<TTestPage> {
	const server: Server = createServer((req, res) => {
		if (req.url === undefined || !respond(req.url, res)) res.writeHead(404).end();
	});
	await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
	const browser: Browser = await chromium.launch(opts.args === undefined ? {} : { args: opts.args });
	const page = await browser.newPage({ viewport: opts.viewport, deviceScaleFactor: opts.deviceScaleFactor });
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	const failedRequests: string[] = [];
	page.on("pageerror", (e) => pageErrors.push(e.message));
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
	page.on("response", (response) => {
		if (response.status() >= 400) failedRequests.push(`${response.request().method()} ${response.url()}: ${response.status()}`);
	});
	const listed = (held: string[]) => (held.length > 0 ? held.join(" | ") : "(empty)");
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
		page,
		pageErrors,
		failures: () => `Page errors: ${listed(pageErrors)}. Console errors: ${listed(consoleErrors)}. Failed requests: ${listed(failedRequests)}.`,
		close: async () => {
			await browser.close();
			await new Promise<void>((res) => server.close(() => res()));
		},
	};
}
