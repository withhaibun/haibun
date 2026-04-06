import { AStepper } from "@haibun/core/lib/astepper.js";
import { TWorld } from "@haibun/core/lib/defs.js";

export default class MonitorJsonRpc extends AStepper {
	description = "Forwards Haibun events to LSP client via JSON-RPC window/logMessage";

	steps = {};

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);

		// Ensure console is suppressed so we don't pollute stdout with raw JSON
		world.eventLogger.suppressConsole = true;

		world.eventLogger.subscribe((event) => {
			// Format as LSP window/logMessage notification
			// type 3 = Info, 1 = Error, 2 = Warning, 4 = Log
			// We'll wrap the whole event JSON in the message for parsing by the client
			// or just log a friendly string.

			const message = `[Haibun] ${JSON.stringify(event)}`;

			const payload = JSON.stringify({
				jsonrpc: "2.0",
				method: "window/logMessage",
				params: {
					type: 3,
					message: message,
				},
			});

			// Write to stdout with Content-Length header as required by LSP
			const content = Buffer.from(payload, "utf8");
			const header = `Content-Length: ${content.length}\r\n\r\n`;
			process.stdout.write(header);
			process.stdout.write(content);
		});
	}
}
