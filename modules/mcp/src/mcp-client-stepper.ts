import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { BasePromptManager } from '@haibun/core/lib/base-prompt-manager.js';
import { AStepper, IHasCycles, IHasOptions, TStepperSteps } from '@haibun/core/lib/astepper.js';
import { TWorld, IStepperCycles } from '@haibun/core/lib/defs.js';
import { TStepArgs } from '@haibun/core/schema/protocol.js';
import { actionNotOK, actionOK, getStepperOption, stringOrError } from '@haibun/core/lib/util/index.js';
import { currentVersion as version } from '@haibun/core/currentVersion.js';
import { TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';


class MCPClientPrompter extends BasePromptManager {
	constructor(private getClient: () => Client | undefined, private getConnectionStatus: () => boolean) {
		super();
	}

	protected showPrompt(prompt: TPrompt): void {
		const client = this.getClient();
		const isConnected = this.getConnectionStatus();

		if (client && isConnected) {
			client.notification({
				method: 'prompt/show',
				params: {
					id: prompt.id,
					message: prompt.message,
					context: prompt.context,
					options: prompt.options,
					timestamp: new Date().toISOString()
				}
			}).catch(error => {
				console.debug(`Failed to send prompt show notification: ${error}`);
			});
		}
	}

	protected hidePrompt(id: string): void {
		const client = this.getClient();
		const isConnected = this.getConnectionStatus();

		if (client && isConnected) {
			client.notification({
				method: 'prompt/hide',
				params: {
					id,
					timestamp: new Date().toISOString()
				}
			}).catch(error => {
				console.debug(`Failed to send prompt hide notification: ${error}`);
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
			console.debug(`MCP prompter failed: ${error}`);
			return undefined;
		}
	}

	async close(): Promise<void> {
		// Connection cleanup is handled by the stepper
	}

	// Public method to manually send notifications for existing prompts
	public notifyPromptShown(prompt: TPrompt): void {
		this.showPrompt(prompt);
	}

	public notifyPromptHidden(id: string): void {
		this.hidePrompt(id);
	}
}

const cycles = (mcs: MCPClientStepper): IStepperCycles => ({
	async startExecution() {
		// Automatically register MCP prompter when execution starts
		await mcs.getClient();
	},
	async endExecution() {
		// Clean up connections and unregister prompter when execution ends
		if (mcs.mcpPrompter) {
			mcs.world.prompter.unsubscribe(mcs.mcpPrompter);
			await mcs.mcpPrompter.close();
			mcs.mcpPrompter = undefined;
		}

		if (mcs.client && mcs.isConnected) {
			await mcs.client.close();
			mcs.isConnected = false;
			mcs.client = undefined;
		}
	}
});

class MCPClientStepper extends AStepper implements IHasOptions, IHasCycles {
	static SERVER = 'SERVER';
	cycles = cycles(this);
	options = {
		[MCPClientStepper.SERVER]: {
			desc: `MCP server to start (stdio)`,
			parse: (input: string) => stringOrError(input)
		},
	}
	serverParameters: StdioServerParameters;
	client?: Client<{ method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; progressToken?: string | number; }; }; }, { method: string; params?: { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }; }, { [x: string]: unknown; _meta?: { [x: string]: unknown; }; }>;
	isConnected = false;
	mcpPrompter?: MCPClientPrompter;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		const serverJson = getStepperOption(this, MCPClientStepper.SERVER, this.world.moduleOptions);
		try {
			this.serverParameters = JSON.parse(serverJson);
		} catch (e) {
			throw new Error(`Failed to parse ${MCPClientStepper.SERVER} option: ${e}`);
		}
	}

	private async ensureConnection(): Promise<void> {
		if (this.isConnected && this.client) {
			return;
		}

		this.client = new Client({ name: "haibun-mcp-client", version });
		const transport = new StdioClientTransport(this.serverParameters);
		await this.client.connect(transport);
		this.isConnected = true;
	}

	// Public method to get client and ensure prompter is registered
	async getClient(): Promise<Client | undefined> {
		await this.ensureConnection();

		if (!this.mcpPrompter && this.client && this.isConnected) {
			this.mcpPrompter = new MCPClientPrompter(() => this.client, () => this.isConnected);
			this.world.prompter.subscribe(this.mcpPrompter);
			this.world.eventLogger.log(undefined, 'info', '📡 MCPClientPrompter registered - real-time notifications enabled');

			// Check for existing prompts on first registration
			await this.checkAndNotifyExistingPrompts();
		}

		return this.client;
	}

	private async fetchDebugPrompts(): Promise<Array<{ id: string, message: string, context?: unknown, options?: string[] }>> {
		const client = await this.getClient();
		const result = await client.callTool({
			name: 'listDebugPrompts',
			arguments: {}
		});

		if (result.content && Array.isArray(result.content) && result.content.length > 0) {
			const content = result.content[0];
			if (content.type === 'text') {
				const promptsData = JSON.parse(content.text);

				if (promptsData.error) {
					throw new Error(`MCP Tool Error: ${promptsData.error}`);
				}

				return promptsData.prompts || [];
			}
		}
		return [];
	}

	private async checkAndNotifyExistingPrompts(): Promise<void> {
		if (!this.mcpPrompter) {
			return;
		}

		try {
			const prompts = await this.fetchDebugPrompts();

			// Send notifications for existing prompts to ensure they're visible
			for (const existingPrompt of prompts) {
				const prompt = {
					id: existingPrompt.id,
					message: existingPrompt.message,
					context: existingPrompt.context,
					options: existingPrompt.options
				};

				this.mcpPrompter.notifyPromptShown(prompt);
				this.world.eventLogger.log(undefined, 'info', `📡 Sent notification for existing prompt: ${prompt.id}`);
			}
		} catch (error) {
			this.world.eventLogger.warn(`Failed to check existing prompts: ${error}`);
		}
	}

	steps = {
		checkAndNotifyExistingPrompts: {
			gwta: `check and notify existing prompts`,
			action: async () => {
				try {
					await this.checkAndNotifyExistingPrompts();
					return actionOK();
				} catch (e) {
					return actionNotOK(`Failed to check existing prompts: ${e}`);
				}
			}
		},
		testRealTimeNotifications: {
			gwta: `test real time notifications`,
			action: async () => {
				try {
					const testPrompt = {
						id: 'test-notification-' + Math.random().toString(36).slice(2),
						message: 'Test real-time notification',
						options: ['test', 'debug']
					};
					this.world.eventLogger.log(undefined, 'debug', `🔧 Testing real-time notification for prompt: ${testPrompt.id}`);
					void this.world.prompter.prompt(testPrompt);
					return actionOK();
				} catch (e) {
					return actionNotOK(`Failed to test real-time notifications: ${e}`);
				}
			}
		},
		listMcpTools: {
			gwta: `list mcp tools`,
			action: async () => {
				try {
					const client = await this.getClient();
					const toolsResult = await client.listTools();
					const tools = Array.isArray(toolsResult) ? toolsResult : (toolsResult.tools || []);
					this.world.eventLogger.info(`MCP tools available: ${tools.map((t: { name: string }) => t.name).join(', ')}`);
					return actionOK();
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					this.world.eventLogger.error(`MCP listTools failed: ${error.message}`);
					return actionNotOK(`Failed to list MCP tools: ${error.message}`);
				}
			}
		},
		listDebugPrompts: {
			gwta: `list debug prompts`,
			action: async () => {
				try {
					const prompts = await this.fetchDebugPrompts();
					const msg = prompts.length > 0
						? `Found ${prompts.length} debug prompt(s): ${prompts.map(p => p.id).join(', ')}`
						: 'No debug prompts';
					this.world.eventLogger.info(msg);
					return actionOK();
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					this.world.eventLogger.error(`MCP listDebugPrompts failed: ${error.message}`);
					return actionNotOK(`Failed to list debug prompts: ${error.message}`);
				}
			}
		},
		respondToDebugPrompt: {
			gwta: `respond to debug prompt {promptId} with {response}`,
			action: async ({ promptId, response }) => {
				try {
					const client = await this.getClient();
					const result = await client.callTool({
						name: 'respondToDebugPrompt',
						arguments: { promptId, response }
					});
					const content = result.content;
					if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
						return actionOK();
					}
					return actionNotOK('No response received from MCP server');
				} catch (e) {
					const error = e instanceof Error ? e : new Error(String(e));
					this.world.eventLogger.error(`MCP respondToDebugPrompt failed: ${error.message}`);
					return actionNotOK(`Failed to respond to debug prompt: ${error.message}`);
				}
			}
		},
		promptViaMcp: {
			gwta: `prompt via mcp {message} with options {options}`,
			action: async ({ message, options }: TStepArgs) => {
				try {
					const client = await this.getClient();
					const prompt: TPrompt = {
						id: 'mcp-' + Math.random().toString(36).slice(2),
						message: String(message),
						options: options ? String(options).split(',').map(o => o.trim()) : undefined
					};
					const result = await client.callTool({
						name: 'handlePrompt',
						arguments: {
							message: prompt.message,
							context: prompt.context ? JSON.stringify(prompt.context) : undefined,
							options: prompt.options || []
						}
					});
					const content = result.content;
					if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
						try {
							const responseData = JSON.parse(content[0].text);
							this.world.eventLogger.info(`MCP prompt response: ${responseData.response}`);
						} catch {
							this.world.eventLogger.info(`MCP prompt response: ${content[0].text}`);
						}
						return actionOK();
					}
					return actionNotOK('No response received from MCP server');
				} catch (e) {
					return actionNotOK(`Failed to prompt via MCP: ${e}`);
				}
			}
		},
		promptViaMcpWithContext: {
			gwta: `prompt via mcp {message} with context {context} and options {options}`,
			action: async ({ message, context, options }: { message: string, context: string, options: string }) => {
				try {
					const client = await this.getClient();
					let parsedContext;
					try {
						parsedContext = JSON.parse(context);
					} catch {
						parsedContext = context;
					}
					const prompt: TPrompt = {
						id: 'mcp-' + Math.random().toString(36).slice(2),
						message,
						context: parsedContext,
						options: options ? options.split(',').map(o => o.trim()) : undefined
					};
					const result = await client.callTool({
						name: 'handlePrompt',
						arguments: {
							message: prompt.message,
							context: JSON.stringify(prompt.context),
							options: prompt.options || []
						}
					});
					const content = result.content;
					if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
						try {
							const responseData = JSON.parse(content[0].text);
							this.world.eventLogger.info(`MCP prompt response: ${responseData.response}`);
						} catch {
							this.world.eventLogger.info(`MCP prompt response: ${content[0].text}`);
						}
						return actionOK();
					}
					return actionNotOK('No response received from MCP server');
				} catch (e) {
					return actionNotOK(`Failed to prompt via MCP: ${e}`);
				}
			}
		}
	} satisfies TStepperSteps
}

export default MCPClientStepper;
