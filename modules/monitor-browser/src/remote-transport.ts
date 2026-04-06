import { type IEventLogger } from "@haibun/core/lib/EventLogger.js";
import type { THaibunEvent } from "@haibun/core/schema/protocol.js";
import { stepTraceStorage } from "@haibun/core/lib/node-http-events.js";
import type { ITransport } from "@haibun/web-server-hono/sse-transport.js";

export class RemoteTransport implements ITransport {
	constructor(
		private ingestUrl: string,
		private logger: IEventLogger,
	) {}

	// biome-ignore lint/suspicious/noExplicitAny: generic message handler
	send(message: any): void {
		// Only send events, not init/finalize control messages for now unless ingest supports them
		if (message.type === "event") {
			void this.post(message.event);
		} else if (message.type === "init") {
			void this.post(message);
		}
	}

	// biome-ignore lint/suspicious/noExplicitAny: generic message handler
	onMessage(cb: (message: any) => void): void {
		// Remote control not yet implemented for piggybacking
	}

	onStreamMessage(): void {
		// Streaming not supported for remote transport
	}

	private consecutiveFailures = 0;
	private disabled = false;

	private async post(event: THaibunEvent) {
		if (this.disabled) return;
		try {
			await stepTraceStorage.run(undefined, async () => {
				await fetch(this.ingestUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(event),
				});
			});
			this.consecutiveFailures = 0;
		} catch (e) {
			this.consecutiveFailures++;
			if (this.consecutiveFailures <= 3) {
				this.logger.warn(`RemoteTransport: Failed to send event to ${this.ingestUrl}: ${e}`);
			}
			if (this.consecutiveFailures === 3) {
				this.logger.warn(`RemoteTransport: disabling after ${this.consecutiveFailures} consecutive failures`);
				this.disabled = true;
			}
		}
	}
}
