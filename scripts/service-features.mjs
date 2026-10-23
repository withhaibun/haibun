// Runs the service features of this repository and checks each serves through its own protocol: the MCP server's feature
// until an MCP client initializes with it, and the language server's feature until it returns the result of an LSP
// initialize over standard input and output. A service stays after its feature ends, as HAIBUN_STAY states, so each run is
// stopped once it is checked.
// Run it after the build and the link of the workspaces' commands: `node scripts/service-features.mjs`.
import { spawn } from "node:child_process";

/** The cli's command, run as its own process so that stopping it stops the service. */
const CLI = "node_modules/.bin/haibun-cli";
const READY_WITHIN_MS = 60_000;
const POLL_MS = 500;
const MCP_PORT = 8129;
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const INITIALIZE = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "service-features", version: "1.0" } };

/** Starts the service feature of a base, whose config.json the base holds, with its standard streams piped, staying as a service does. */
const serve = (base, feature) => spawn(CLI, [base, feature], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HAIBUN_STAY: "always" } });

/** Resolves with what `check` returns once it returns a value, polling until the service's time to be ready passes. */
async function within(what, child, check) {
	const output = [];
	child.stdout.on("data", (chunk) => output.push(chunk));
	child.stderr.on("data", (chunk) => output.push(chunk));
	const ended = new Promise((_, reject) =>
		child.on("exit", (code) => reject(new Error(`${what} ended with ${code} before it served:\n${Buffer.concat(output).toString().slice(-4000)}`))),
	);
	const deadline = Date.now() + READY_WITHIN_MS;
	const polled = (async () => {
		while (Date.now() < deadline) {
			const found = await Promise.try(check).catch(() => undefined);
			if (found !== undefined) return found;
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
		throw new Error(`${what} didn't serve within ${READY_WITHIN_MS}ms:\n${Buffer.concat(output).toString().slice(-4000)}`);
	})();
	return await Promise.race([polled, ended]);
}

/** The MCP server's feature serves once an MCP client initializes with it. */
async function mcpServes() {
	const child = serve("mcp-server", "serve-mcp");
	try {
		const url = `http://localhost:${MCP_PORT}/mcp`;
		const serverInfo = await within("the MCP server's feature", child, async () => {
			const response = await fetch(url, { method: "POST", headers: MCP_HEADERS, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: INITIALIZE }) });
			return (await response.json()).result?.serverInfo;
		});
		return `MCP ${serverInfo.name} serves at ${url}`;
	} finally {
		child.kill();
	}
}

/** The language server's feature serves once it returns the result of an LSP initialize, framed by its content length. */
async function lspServes() {
	const child = serve("vscode-extension/lsp-server", "serve-lsp");
	try {
		let received = "";
		child.stdout.on("data", (chunk) => {
			received += chunk.toString();
		});
		const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: process.pid, rootUri: null, capabilities: {} } });
		child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
		const capabilities = await within("the language server's feature", child, () => {
			const framed = received.split(/Content-Length: \d+\r\n\r\n/).slice(1);
			const result = framed.map((text) => JSON.parse(text)).find((message) => message.id === 1);
			return result?.result?.capabilities;
		});
		return `the language server returns from initialize ${Object.keys(capabilities).join(", ")}`;
	} finally {
		child.kill();
	}
}

for (const check of [mcpServes, lspServes]) console.log(await check());
