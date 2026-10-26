/**
 * The language server the editor's extension launches responds to an LSP client over standard input and output: the cli runs the
 * serve-lsp feature of `vscode-extension/lsp-server`, as the extension launches it, and returns the result of an LSP initialize.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY = join(import.meta.dirname, "..");

/** The base the extension launches, which holds the language server's config. */
const LSP_SERVER = join(REPOSITORY, "vscode-extension", "lsp-server");
/** The time the server takes to start and respond, beside the other tests. */
const RESPONSE_TIMEOUT_MS = 60_000;
const FRAME_HEADER = /Content-Length: (\d+)\r\n\r\n/g;

/** Each whole message of LSP's framing in `received`: the number of bytes its header states, so a line written after it isn't read as
 *  part of it, and a message whose bytes haven't all arrived isn't read yet. */
const framed = (received: Buffer): { id?: number; result?: { capabilities?: Record<string, unknown> } }[] =>
	[...received.toString("latin1").matchAll(FRAME_HEADER)]
		.map((header) => ({ start: header.index + header[0].length, end: header.index + header[0].length + Number(header[1]) }))
		.filter(({ end }) => end <= received.length)
		.map(({ start, end }) => JSON.parse(received.subarray(start, end).toString()));

describe("the language server's feature", () => {
	it(
		"returns the capabilities of an LSP initialize",
		async () => {
			const cli = createRequire(import.meta.url).resolve("@haibun/cli");
			const child = spawn(process.execPath, [cli, "-c", "config.json", ".", "serve-lsp"], { cwd: LSP_SERVER, env: { ...process.env, HAIBUN_STAY: "always" } });
			const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
			child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
			try {
				const capabilities = await new Promise<Record<string, unknown>>((resolve, reject) => {
					let received = Buffer.alloc(0);
					child.on("exit", (code) => reject(new Error(`the language server ended with ${code} before it responded`)));
					child.stdout.on("data", (chunk: Buffer) => {
						received = Buffer.concat([received, chunk]);
						const responded = framed(received).find((message) => message.id === 1)?.result?.capabilities;
						if (responded !== undefined) resolve(responded);
					});
				});
				expect(Object.keys(capabilities)).toEqual(expect.arrayContaining(["textDocumentSync", "completionProvider", "hoverProvider", "semanticTokensProvider"]));
			} finally {
				child.kill();
			}
		},
		RESPONSE_TIMEOUT_MS,
	);
});
