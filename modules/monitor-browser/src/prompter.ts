import { IPrompter, TPrompt, TPromptResponse } from "@haibun/core/lib/prompter.js";
import type { ITransport } from "@haibun/web-server-hono/sse-transport.js";

export class SSEPrompter implements IPrompter {
	private transport: ITransport;
	private resolveMap = new Map<string, (value: TPromptResponse) => void>();

	constructor(transport: ITransport) {
		this.transport = transport;
		this.transport.onMessage(this.handleMessage);
	}

	setTransport(transport: ITransport) {
		this.transport = transport;
		this.transport.onMessage(this.handleMessage);
	}

	private handleMessage = (data: unknown) => {
		const msg = data as { type?: string; id?: string; value?: TPromptResponse };
		if (msg.type === "response" && msg.id) {
			const resolve = this.resolveMap.get(msg.id);
			if (resolve) {
				resolve(msg.value);
				this.resolveMap.delete(msg.id);
			}
		}
	};

	prompt(prompt: TPrompt): Promise<TPromptResponse> {
		this.transport.send({ type: "prompt", prompt });
		return new Promise((resolve) => {
			this.resolveMap.set(prompt.id, resolve);
		});
	}

	cancel(id: string, reason?: string) {
		this.transport.send({ type: "cancel", id, reason });
		this.resolveMap.delete(id);
	}

	resolve(id: string, value: TPromptResponse) {
		this.transport.send({ type: "resolve", id, value });
		const resolve = this.resolveMap.get(id);
		if (resolve) {
			resolve(value);
			this.resolveMap.delete(id);
		}
	}
}
