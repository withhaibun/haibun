import { TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';
import { BasePromptManager } from '@haibun/core/lib/base-prompt-manager.js';
import { HTTP_PROMPTER_ENDPOINTS } from './http-executor-stepper.js';

export class HttpClientPrompter extends BasePromptManager {
	private lastPromptIds = new Set<string>();
	private polling = false;
	private stopPolling = false;
	private pendingPromptResolves = new Map<string, (response: TPromptResponse) => void>();

	constructor(private serverUrl: string, private accessToken: string) {
		super();
	}

	protected showPrompt(prompt: TPrompt): void { }
	protected hidePrompt(id: string): void { }

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		if (!prompt.id) {
			throw new Error('Prompt must have an id. Use makePrompt to create prompts.');
		}
		if (!this.polling) {
			void this.pollForPrompts();
		}
		return new Promise<TPromptResponse>((resolve) => {
			this.pendingPromptResolves.set(prompt.id, resolve);
		});
	}

	cancel(promptId?: string): void {
		if (promptId) {
			const resolve = this.pendingPromptResolves.get(promptId);
			if (resolve) {
				resolve(undefined);
				this.pendingPromptResolves.delete(promptId);
			}
		} else {
			// If no promptId is provided, do nothing
		}
	}

	close(): void {
		// Stop polling and cancel all pending prompts
		this.stopPolling = true;
		this.pendingPromptResolves.forEach(resolve => resolve(undefined));
		this.pendingPromptResolves.clear();
	}

	private async pollForPrompts() {
		this.polling = true;
		while (!this.stopPolling) {
			try {
				const res = await fetch(`${this.serverUrl}${HTTP_PROMPTER_ENDPOINTS.PROMPTS}`, {
					headers: { 'Authorization': `Bearer ${this.accessToken}` }
				});
				if (res.ok) {
					const { prompts } = await res.json();
					for (const prompt of prompts) {
						if (!this.lastPromptIds.has(prompt.id)) {
							const resolve = this.pendingPromptResolves.get(prompt.id);
							if (resolve) {
								this.lastPromptIds.add(prompt.id);
								await fetch(`${this.serverUrl}${HTTP_PROMPTER_ENDPOINTS.PROMPT_RESPONSE}`, {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										'Authorization': `Bearer ${this.accessToken}`
									},
									body: JSON.stringify({ promptId: prompt.id, response: prompt.response ?? 'ok' })
								});
								resolve(prompt.response ?? 'ok');
								this.pendingPromptResolves.delete(prompt.id);
							}
						}
					}
				}
			} catch (e) {
				// ignore errors, just keep polling
			}
			await new Promise(r => setTimeout(r, 500));
		}
		this.polling = false;
	}
}
