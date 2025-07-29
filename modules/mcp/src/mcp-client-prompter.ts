import { BasePromptManager } from '@haibun/core/lib/base-prompt-manager.js';
import { TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

export class MCPClientPrompter extends BasePromptManager {
	constructor(private getClient: () => Client | undefined, private getConnectionStatus: () => boolean) {
		super();
	}

	protected showPrompt(prompt: TPrompt): void {
		const client = this.getClient();
		const isConnected = this.getConnectionStatus();

		if (client && isConnected) {
			client.notification({
				method: 'prompt/show',
				params: { ...prompt, timestamp: new Date().toISOString() }
			}).catch(error => {
				console.error(`Failed to send prompt show notification: ${error}`);
			});
		}
	}

	protected hidePrompt(id: string): void {
		const client = this.getClient();
		const isConnected = this.getConnectionStatus();

		if (client && isConnected) {
			client.notification({
				method: 'prompt/hide',
				params: { id, timestamp: new Date().toISOString() }
			}).catch(error => {
				console.error(`Failed to send prompt hide notification: ${error}`);
			});
		}
	}

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		try {
			const client = this.getClient();
			const isConnected = this.getConnectionStatus();

			if (!client || !isConnected) {
				return undefined;
			}

			const result = await client.callTool({
				name: 'handlePrompt',
				arguments: {
					message: prompt.message,
					context: prompt.context ? JSON.stringify(prompt.context) : undefined,
					options: prompt.options || []
				}
			});

			if (result.content && Array.isArray(result.content) && result.content.length > 0) {
				const content = result.content[0];
				if (content.type === 'text') {
					try {
						const responseData = JSON.parse(content.text);
						return responseData.response;
					} catch {
						return content.text;
					}
				}
			}

			return undefined;

		} catch (error) {
			console.error(`MCP prompter failed: ${error}`);
			return undefined;
		}
	}

	// Public method to manually send notifications for existing prompts
	public notifyPromptShown(prompt: TPrompt): void {
		this.showPrompt(prompt);
	}

	public notifyPromptHidden(id: string): void {
		this.hidePrompt(id);
	}
}
